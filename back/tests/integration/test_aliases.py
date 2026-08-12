"""Frontmatter alias resolution + quick-switcher alias matches."""

import uuid

import pytest
from httpx import AsyncClient

ALIASED = "---\naliases:\n  - Nickname\n  - Second Name\n---\nThe canonical note.\n"


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"alias-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Alias Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {"headers": headers, "vault_id": vaults[0]["id"]}


async def _create(client: AsyncClient, ws: dict, title: str, content: str = "") -> dict:
    resp = await client.post(
        f"/api/v1/vaults/{ws['vault_id']}/notes",
        json={"title": title, "content": content},
        headers=ws["headers"],
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


async def _backlink_titles(client: AsyncClient, ws: dict, note_id: str) -> set[str]:
    resp = await client.get(f"/api/v1/vaults/{ws['vault_id']}/notes/{note_id}/backlinks", headers=ws["headers"])
    assert resp.status_code == 200
    return {b["title"] for b in resp.json()["data"]["backlinks"]}


async def test_wikilink_resolves_through_alias(client: AsyncClient, workspace: dict) -> None:
    target = await _create(client, workspace, "Canonical", ALIASED)
    await _create(client, workspace, "Referrer", "See [[Nickname]] for details.")
    assert "Referrer" in await _backlink_titles(client, workspace, target["id"])


async def test_new_alias_claims_existing_unresolved_links(client: AsyncClient, workspace: dict) -> None:
    await _create(client, workspace, "Early bird", "Mentions [[Ghost Name]] before it exists.")
    target = await _create(client, workspace, "Late note", "---\naliases: [Ghost Name]\n---\nNow I exist.")
    assert "Early bird" in await _backlink_titles(client, workspace, target["id"])


async def test_removing_alias_unresolves_links(client: AsyncClient, workspace: dict) -> None:
    target = await _create(client, workspace, "Shifty", ALIASED)
    await _create(client, workspace, "Pointer", "Points at [[Nickname]].")
    assert "Pointer" in await _backlink_titles(client, workspace, target["id"])

    resp = await client.put(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{target['id']}/content",
        json={"content": "No more aliases."},
        headers=workspace["headers"],
    )
    assert resp.status_code == 200, resp.text
    assert "Pointer" not in await _backlink_titles(client, workspace, target["id"])


async def test_quick_switcher_matches_alias(client: AsyncClient, workspace: dict) -> None:
    await _create(client, workspace, "Canonical", ALIASED)
    resp = await client.get(
        f"/api/v1/vaults/{workspace['vault_id']}/quick-switch",
        params={"q": "Nickna"},
        headers=workspace["headers"],
    )
    assert resp.status_code == 200
    results = resp.json()["data"]
    match = next((r for r in results if r.get("alias") == "Nickname"), None)
    assert match is not None, results
    assert match["title"] == "Canonical"
