"""Bring-your-own-key AI credentials.

The property that matters: a user's provider key goes in and never comes back
out — not through the AI endpoints, not through the auth endpoints that
serialize `users.settings`, and not to another user. And what lands in the
database is ciphertext.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import async_session_factory
from app.models.ai import AICredential

# Deliberately NOT shaped like a real provider key ("sk-ant-…"): secret
# scanners flag the vendor prefix on every diff that touches this file, and a
# permanently-failing scanner is worse than no scanner. Nothing validates the
# format, and the assertions only rely on the value and its last four chars.
SECRET_KEY_VALUE = "fake-provider-key-DO-NOT-ECHO-4f2b9c"


async def _signup(client: AsyncClient, prefix: str) -> dict:
    creds = {
        "email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "AI Tester",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return resp.json()["data"]


@pytest.fixture
async def account(client: AsyncClient) -> dict:
    return await _signup(client, "ai")


def _auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_status_is_unconfigured_before_anything_is_saved(client: AsyncClient, account: dict) -> None:
    resp = await client.get("/api/v1/ai/status", headers=_auth(account))
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["configured"] is False
    assert data["active_provider"] is None
    # The UI needs the provider catalogue even before anything is set up.
    assert {p["id"] for p in data["providers"]} == {"anthropic", "openai", "gemini", "qwen"}


async def test_the_key_is_stored_encrypted_and_never_returned(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    saved = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "anthropic", "api_key": SECRET_KEY_VALUE, "model": "claude-sonnet-4-5"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert SECRET_KEY_VALUE not in saved.text

    status = await client.get("/api/v1/ai/status", headers=headers)
    body = status.json()["data"]
    assert body["configured"] is True
    assert body["active_provider"] == "anthropic"
    assert body["active_model"] == "claude-sonnet-4-5"
    assert SECRET_KEY_VALUE not in status.text
    # A hint, not the key: enough to recognise which key is stored. Derived
    # from the fixture rather than hardcoded so it cannot rot if the value
    # changes — the shape (first 6, ellipsis, last 4) is what matters.
    assert body["credentials"][0]["key_hint"] == f"{SECRET_KEY_VALUE[:6]}…{SECRET_KEY_VALUE[-4:]}"

    # The auth endpoints serialize users.settings in full — the key must not be
    # anywhere in there either.
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert SECRET_KEY_VALUE not in me.text
    assert me.json()["data"]["settings"].get("aiProvider") == "anthropic"

    # And the column itself is ciphertext.
    async with async_session_factory() as session:
        row = (await session.execute(select(AICredential).where(AICredential.provider == "anthropic"))).scalars().all()
        stored = [c for c in row if c.key_hint.endswith(SECRET_KEY_VALUE[-4:])]
        assert stored, "credential row not found"
        assert SECRET_KEY_VALUE not in stored[0].key_ciphertext
        assert stored[0].key_ciphertext.startswith("v1:")


async def test_another_user_cannot_see_or_delete_it(client: AsyncClient, account: dict) -> None:
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "model": "gpt-4.1"},
        headers=_auth(account),
    )
    other = await _signup(client, "ai-other")
    status = await client.get("/api/v1/ai/status", headers=_auth(other))
    assert status.json()["data"]["configured"] is False
    assert SECRET_KEY_VALUE not in status.text

    removed = await client.delete("/api/v1/ai/credentials/openai", headers=_auth(other))
    assert removed.status_code == 404

    # The owner still has it.
    mine = await client.get("/api/v1/ai/status", headers=_auth(account))
    assert mine.json()["data"]["configured"] is True


async def test_model_can_be_changed_without_re_pasting_the_key(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "model": "gpt-4.1"},
        headers=headers,
    )
    changed = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "model": "gpt-4.1-mini"},
        headers=headers,
    )
    assert changed.status_code == 200, changed.text
    status = (await client.get("/api/v1/ai/status", headers=headers)).json()["data"]
    assert status["active_model"] == "gpt-4.1-mini"
    assert status["credentials"][0]["key_hint"].endswith(SECRET_KEY_VALUE[-4:])


async def test_deleting_clears_the_active_provider(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "gemini", "api_key": SECRET_KEY_VALUE, "model": "gemini-2.5-flash"},
        headers=headers,
    )
    assert (await client.delete("/api/v1/ai/credentials/gemini", headers=headers)).status_code == 200
    status = (await client.get("/api/v1/ai/status", headers=headers)).json()["data"]
    assert status["configured"] is False
    assert status["active_provider"] is None


async def test_unknown_provider_is_refused(client: AsyncClient, account: dict) -> None:
    resp = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "totally-made-up", "api_key": "x", "model": "y"},
        headers=_auth(account),
    )
    assert resp.status_code == 422


async def test_chat_without_a_key_says_so(client: AsyncClient, account: dict) -> None:
    resp = await client.post(
        "/api/v1/ai/chat",
        json={"messages": [{"role": "user", "content": "hello"}]},
        headers=_auth(account),
    )
    assert resp.status_code == 404
    assert "configured" in resp.json()["error"]["message"].lower()


async def test_ai_endpoints_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/ai/status")).status_code == 401
    assert (await client.put("/api/v1/ai/credentials", json={"provider": "openai", "api_key": "x"})).status_code == 401


async def test_private_base_url_is_refused(client: AsyncClient, account: dict) -> None:
    """base_url is a URL the *server* fetches, so it must not reach inside.

    Unvalidated, any signed-up user can aim it at the cloud metadata endpoint
    or the compose network and read the provider error to fingerprint what
    answered.
    """
    headers = _auth(account)
    for endpoint in (
        "http://169.254.169.254/latest/meta-data",  # cloud metadata
        "http://127.0.0.1:8000",  # the API itself
        "http://localhost:9000",  # MinIO
        "http://10.0.0.5/v1",  # RFC1918
    ):
        resp = await client.put(
            "/api/v1/ai/credentials",
            headers=headers,
            json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "base_url": endpoint},
        )
        assert resp.status_code == 422, f"{endpoint} was accepted: {resp.text}"
        assert resp.json()["error"]["code"] == "validation_failed"


async def test_malformed_base_url_is_refused(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    for endpoint in ("file:///etc/passwd", "gopher://x", "http://user:pw@example.com", "not-a-url"):
        resp = await client.put(
            "/api/v1/ai/credentials",
            headers=headers,
            json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "base_url": endpoint},
        )
        assert resp.status_code == 422, f"{endpoint} was accepted: {resp.text}"


async def test_public_base_url_is_still_allowed(client: AsyncClient, account: dict) -> None:
    """Self-hosting on a public host stays supported — this is not a ban."""
    resp = await client.put(
        "/api/v1/ai/credentials",
        headers=_auth(account),
        json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "base_url": "https://api.openai.com/v1"},
    )
    assert resp.status_code == 200, resp.text


# ── Per-vault keys ──────────────────────────────────────────────────────────


async def _vaults(client: AsyncClient, headers: dict) -> list[dict]:
    return (await client.get("/api/v1/vaults", headers=headers)).json()["data"]


async def test_a_vault_can_bring_its_own_key_which_wins_there_only(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    vault_id = (await _vaults(client, headers))[0]["id"]
    other = (await client.post("/api/v1/vaults", json={"name": "Other"}, headers=headers)).json()["data"]["id"]
    # Account key: openai. Vault key for `vault_id`: anthropic.
    assert (
        await client.put(
            "/api/v1/ai/credentials",
            json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "model": "gpt-4.1"},
            headers=headers,
        )
    ).status_code == 200
    saved = await client.put(
        "/api/v1/ai/credentials",
        json={
            "provider": "anthropic",
            "api_key": "fake-vault-key-0000-9e1d",
            "model": "claude-haiku-4-5",
            "vault_id": vault_id,
        },
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["scope"] == "vault"

    # Status for that vault: the vault's key is what chat uses; the account's
    # is still listed as the account's.
    st = (await client.get(f"/api/v1/ai/status?vault_id={vault_id}", headers=headers)).json()["data"]
    assert st["effective_scope"] == "vault"
    assert st["active_provider"] == "anthropic" and st["active_model"] == "claude-haiku-4-5"
    assert st["account"]["active_provider"] == "openai"
    assert [c["provider"] for c in st["vault"]["credentials"]] == ["anthropic"]
    assert "fake-vault-key" not in (await client.get(f"/api/v1/ai/status?vault_id={vault_id}", headers=headers)).text

    # The other vault has none of its own → the account's.
    st2 = (await client.get(f"/api/v1/ai/status?vault_id={other}", headers=headers)).json()["data"]
    assert st2["effective_scope"] == "account" and st2["active_provider"] == "openai"
    assert st2["vault"]["configured"] is False
    # And without a vault: the account view, unchanged in shape.
    st3 = (await client.get("/api/v1/ai/status", headers=headers)).json()["data"]
    assert st3["active_provider"] == "openai" and st3["vault"] is None

    # What resolve() hands the chat: the vault's key in that vault, the
    # account's elsewhere.
    from uuid import UUID

    from app.core.db import async_session_factory
    from app.services import ai_service

    me = (await client.get("/api/v1/auth/me", headers=headers)).json()["data"]
    async with async_session_factory() as session:
        in_vault = (await ai_service.resolve(session, UUID(me["id"]), vault_id=UUID(vault_id))).unwrap()
        elsewhere = (await ai_service.resolve(session, UUID(me["id"]), vault_id=UUID(other))).unwrap()
    assert in_vault[0].provider == "anthropic" and in_vault[1] == "fake-vault-key-0000-9e1d"
    assert elsewhere[0].provider == "openai" and elsewhere[1] == SECRET_KEY_VALUE

    # Removing the vault's key: back to the account's; the account key stays.
    gone = await client.delete(f"/api/v1/ai/credentials/anthropic?vault_id={vault_id}", headers=headers)
    assert gone.status_code == 200
    st4 = (await client.get(f"/api/v1/ai/status?vault_id={vault_id}", headers=headers)).json()["data"]
    assert st4["effective_scope"] == "account" and st4["active_provider"] == "openai"


async def test_a_vault_key_cannot_be_set_on_someone_elses_vault(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    stranger = _auth(await _signup(client, "ai-stranger"))
    theirs = (await _vaults(client, stranger))[0]["id"]
    resp = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "model": "m", "vault_id": theirs},
        headers=headers,
    )
    assert resp.status_code == 404
    assert (await client.get(f"/api/v1/ai/status?vault_id={theirs}", headers=headers)).status_code == 404


async def test_deleting_a_vault_takes_its_keys_with_it(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    vault_id = (await client.post("/api/v1/vaults", json={"name": "Disposable"}, headers=headers)).json()["data"]["id"]
    assert (
        await client.put(
            "/api/v1/ai/credentials",
            json={
                "provider": "gemini",
                "api_key": "fake-disposable-key-77aa",
                "model": "gemini-2.5-flash",
                "vault_id": vault_id,
            },
            headers=headers,
        )
    ).status_code == 200
    assert (await client.delete(f"/api/v1/vaults/{vault_id}", headers=headers)).status_code == 200
    async with async_session_factory() as session:
        rows = (
            (await session.execute(select(AICredential).where(AICredential.key_hint.endswith("77aa")))).scalars().all()
        )
    assert rows == []
