"""Whole-vault publishing — public sites at /public/sites/{slug}."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"site-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Site Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {"headers": headers, "vault_id": vaults[0]["id"]}


async def test_publish_serves_site_and_notes_without_auth(client: AsyncClient, workspace: dict) -> None:
    h, vault = workspace["headers"], workspace["vault_id"]
    await client.post(
        f"/api/v1/vaults/{vault}/notes",
        json={"title": "Public page", "content": "Open [[Welcome to Nodum]]!"},
        headers=h,
    )
    await client.post(
        f"/api/v1/vaults/{vault}/notes",
        json={"title": "Secret page", "content": "---\npublish: false\n---\nHidden."},
        headers=h,
    )

    pub = await client.post(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    assert pub.status_code == 200, pub.text
    slug = pub.json()["data"]["slug"]

    # Public index — NO auth headers
    site = await client.get(f"/api/v1/public/sites/{slug}")
    assert site.status_code == 200
    titles = {n["title"] for n in site.json()["data"]["notes"]}
    assert "Public page" in titles
    assert "Secret page" not in titles

    note = await client.get(f"/api/v1/public/sites/{slug}/note", params={"path": "Public page"})
    assert note.status_code == 200
    assert "[[Welcome to Nodum]]" in note.json()["data"]["content"]

    # publish:false note 404s even by direct path
    hidden = await client.get(f"/api/v1/public/sites/{slug}/note", params={"path": "Secret page"})
    assert hidden.status_code == 404


async def test_unpublish_404s_site(client: AsyncClient, workspace: dict) -> None:
    h, vault = workspace["headers"], workspace["vault_id"]
    pub = await client.post(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    slug = pub.json()["data"]["slug"]
    assert (await client.get(f"/api/v1/public/sites/{slug}")).status_code == 200

    await client.delete(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    assert (await client.get(f"/api/v1/public/sites/{slug}")).status_code == 404

    # Republish keeps the same slug
    again = await client.post(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    assert again.json()["data"]["slug"] == slug


async def test_status_reflects_state(client: AsyncClient, workspace: dict) -> None:
    h, vault = workspace["headers"], workspace["vault_id"]
    before = await client.get(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    assert before.json()["data"]["enabled"] is False
    await client.post(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    after = await client.get(f"/api/v1/vaults/{vault}/publish-site", headers=h)
    assert after.json()["data"]["enabled"] is True
