"""Sprint-1 hardening acceptance tests."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def account(client: AsyncClient) -> dict:
    creds = {
        "email": f"hard-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "Hardening",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    data = resp.json()["data"]
    return {"creds": creds, "tokens": data}


async def test_oversized_upload_rejected_streamingly(client: AsyncClient, account: dict) -> None:
    headers = {"Authorization": f"Bearer {account['tokens']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]

    oversized = b"x" * (26 * 1024 * 1024)  # cap is 25MB
    resp = await client.post(
        f"/api/v1/vaults/{vault_id}/attachments",
        files={"file": ("huge.bin", oversized, "application/octet-stream")},
        headers=headers,
    )
    assert resp.status_code == 422
    assert "too large" in resp.json()["error"]["message"].lower()


async def test_logout_revokes_access_token_instantly(client: AsyncClient, account: dict) -> None:
    access = account["tokens"]["access_token"]
    refresh = account["tokens"]["refresh_token"]
    headers = {"Authorization": f"Bearer {access}"}

    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200

    out = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert out.status_code == 200

    # The 15-minute token is dead NOW, not at expiry
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401


async def test_password_change_revokes_all_access_tokens(client: AsyncClient, account: dict) -> None:
    creds = account["creds"]
    # Two live sessions (two devices)
    login1 = (
        await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    ).json()["data"]
    client.cookies.clear()
    login2 = (
        await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    ).json()["data"]
    client.cookies.clear()

    h1 = {"Authorization": f"Bearer {login1['access_token']}"}
    h2 = {"Authorization": f"Bearer {login2['access_token']}"}
    assert (await client.get("/api/v1/auth/me", headers=h1)).status_code == 200

    changed = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": creds["password"], "new_password": "brand-new-Password-9"},
        headers=h2,
    )
    assert changed.status_code == 200

    # BOTH devices' access tokens are dead immediately
    assert (await client.get("/api/v1/auth/me", headers=h1)).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=h2)).status_code == 401


async def test_signup_is_atomic_with_vault(client: AsyncClient, account: dict) -> None:
    """The signup response itself proves user+vault exist; verify vault content too."""
    headers = {"Authorization": f"Bearer {account['tokens']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    assert len(vaults) == 1 and vaults[0]["name"] == "My Vault"
    tree = (await client.get(f"/api/v1/vaults/{vaults[0]['id']}/tree", headers=headers)).json()["data"]
    assert len([i for i in tree["items"] if i["type"] == "note"]) >= 3
