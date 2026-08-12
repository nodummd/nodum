"""Daily notes & templates integration tests."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"daily-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Daily Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    return {"headers": headers, "vault_id": vault_id, "base": f"/api/v1/vaults/{vault_id}"}


async def test_daily_note_created_then_reused(client: AsyncClient, workspace: dict) -> None:
    r1 = await client.post(f"{workspace['base']}/daily-note", headers=workspace["headers"])
    assert r1.status_code == 200, r1.text
    note = r1.json()["data"]
    assert len(note["title"]) == 10  # YYYY-MM-DD

    r2 = await client.post(f"{workspace['base']}/daily-note", headers=workspace["headers"])
    assert r2.json()["data"]["id"] == note["id"]  # same day → same note


async def test_daily_note_uses_folder_and_template(client: AsyncClient, workspace: dict) -> None:
    # Template note with variables
    tpl_folder = await client.post(
        f"{workspace['base']}/folders", json={"name": "Templates"}, headers=workspace["headers"]
    )
    tpl = await client.post(
        f"{workspace['base']}/notes",
        json={
            "title": "Daily",
            "folder_id": tpl_folder.json()["data"]["id"],
            "content": "# {{title}}\n\nCreated {{date}} at {{time}}. Week format: {{date:YYYY/MM}}",
        },
        headers=workspace["headers"],
    )
    assert tpl.status_code == 201

    # Configure vault settings
    cfg = await client.patch(
        f"/api/v1/vaults/{workspace['vault_id']}",
        json={
            "settings": {
                "dailyNoteFolder": "Journal",
                "dailyNoteTemplate": "Templates/Daily",
            }
        },
        headers=workspace["headers"],
    )
    assert cfg.status_code == 200

    r = await client.post(f"{workspace['base']}/daily-note", headers=workspace["headers"])
    assert r.status_code == 200, r.text
    note = r.json()["data"]
    assert note["path"].startswith("Journal/")
    assert f"# {note['title']}" in note["content"]
    assert "{{" not in note["content"]  # all vars substituted


async def test_templates_listing_and_insert(client: AsyncClient, workspace: dict) -> None:
    folder = await client.post(f"{workspace['base']}/folders", json={"name": "Templates"}, headers=workspace["headers"])
    await client.post(
        f"{workspace['base']}/notes",
        json={
            "title": "Meeting",
            "folder_id": folder.json()["data"]["id"],
            "content": "## Meeting {{date}}\n- [ ] agenda",
        },
        headers=workspace["headers"],
    )

    listing = await client.get(f"{workspace['base']}/templates", headers=workspace["headers"])
    assert listing.status_code == 200
    templates = listing.json()["data"]
    assert [t["title"] for t in templates] == ["Meeting"]

    target = await client.post(f"{workspace['base']}/notes", json={"title": "Standup"}, headers=workspace["headers"])
    target_id = target.json()["data"]["id"]

    inserted = await client.post(
        f"{workspace['base']}/notes/{target_id}/insert-template/{templates[0]['id']}",
        headers=workspace["headers"],
    )
    assert inserted.status_code == 200
    body = inserted.json()["data"]["content"]
    assert body.startswith("## Meeting ")
    assert "{{date}}" not in body
