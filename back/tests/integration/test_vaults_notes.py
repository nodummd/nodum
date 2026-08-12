"""Vault/folder/note integration tests — require dev infra up."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def auth(client: AsyncClient) -> dict[str, str]:
    """A fresh signed-up user; returns auth headers."""
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"vault-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Vault Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}


async def test_signup_creates_default_vault_with_welcome_notes(client: AsyncClient, auth: dict) -> None:
    resp = await client.get("/api/v1/vaults", headers=auth)
    assert resp.status_code == 200
    vaults = resp.json()["data"]
    assert len(vaults) == 1
    assert vaults[0]["name"] == "My Vault"

    tree = await client.get(f"/api/v1/vaults/{vaults[0]['id']}/tree", headers=auth)
    assert tree.status_code == 200
    titles = {item["title"] for item in tree.json()["data"]["items"] if item["type"] == "note"}
    assert "Welcome to Nodum" in titles
    assert "Linking your thinking" in titles


async def test_vault_crud(client: AsyncClient, auth: dict) -> None:
    created = await client.post("/api/v1/vaults", json={"name": "Research"}, headers=auth)
    assert created.status_code == 201
    vault_id = created.json()["data"]["id"]

    dup = await client.post("/api/v1/vaults", json={"name": "Research"}, headers=auth)
    assert dup.status_code == 409

    renamed = await client.patch(f"/api/v1/vaults/{vault_id}", json={"name": "Research 2026"}, headers=auth)
    assert renamed.status_code == 200
    assert renamed.json()["data"]["name"] == "Research 2026"

    settings = await client.patch(
        f"/api/v1/vaults/{vault_id}", json={"settings": {"dailyNoteFormat": "YYYY-MM-DD"}}, headers=auth
    )
    assert settings.status_code == 200
    assert settings.json()["data"]["settings"]["dailyNoteFormat"] == "YYYY-MM-DD"

    deleted = await client.delete(f"/api/v1/vaults/{vault_id}", headers=auth)
    assert deleted.status_code == 200


async def test_vault_isolation_between_users(client: AsyncClient, auth: dict) -> None:
    """User B must never see or touch user A's vault."""
    vaults = (await client.get("/api/v1/vaults", headers=auth)).json()["data"]
    vault_a = vaults[0]["id"]

    other = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"vault-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Other",
        },
    )
    client.cookies.clear()
    headers_b = {"Authorization": f"Bearer {other.json()['data']['access_token']}"}

    assert (await client.get(f"/api/v1/vaults/{vault_a}/tree", headers=headers_b)).status_code == 404
    assert (
        await client.post(f"/api/v1/vaults/{vault_a}/notes", json={"title": "Intrusion"}, headers=headers_b)
    ).status_code == 404


async def test_folders_and_notes_lifecycle(client: AsyncClient, auth: dict) -> None:
    vault_id = (await client.get("/api/v1/vaults", headers=auth)).json()["data"][0]["id"]
    base = f"/api/v1/vaults/{vault_id}"

    # Folder hierarchy: Projects/Active
    projects = await client.post(f"{base}/folders", json={"name": "Projects"}, headers=auth)
    assert projects.status_code == 201
    projects_id = projects.json()["data"]["id"]

    active = await client.post(f"{base}/folders", json={"name": "Active", "parent_id": projects_id}, headers=auth)
    assert active.status_code == 201
    assert active.json()["data"]["path"] == "Projects/Active"
    active_id = active.json()["data"]["id"]

    # Note inside nested folder
    note = await client.post(
        f"{base}/notes",
        json={"title": "Nodum roadmap", "folder_id": active_id, "content": "# Roadmap\n\nShip it."},
        headers=auth,
    )
    assert note.status_code == 201
    note_data = note.json()["data"]
    assert note_data["path"] == "Projects/Active/Nodum roadmap"
    assert note_data["word_count"] == 4

    # Invalid title characters rejected
    bad = await client.post(f"{base}/notes", json={"title": "bad[title]"}, headers=auth)
    assert bad.status_code == 422

    # Duplicate path rejected
    dup = await client.post(f"{base}/notes", json={"title": "Nodum roadmap", "folder_id": active_id}, headers=auth)
    assert dup.status_code == 409

    # Content update + word count + frontmatter properties
    updated = await client.put(
        f"{base}/notes/{note_data['id']}/content",
        json={"content": "---\ntags:\n  - roadmap\nstatus: active\n---\n\n# Roadmap v2\n\nMore words here now."},
        headers=auth,
    )
    assert updated.status_code == 200
    body = updated.json()["data"]
    assert body["properties"]["status"] == "active"
    assert body["properties"]["tags"] == ["roadmap"]

    # Optimistic concurrency: stale base_updated_at → 409
    stale = await client.put(
        f"{base}/notes/{note_data['id']}/content",
        json={"content": "overwrite attempt", "base_updated_at": note_data["updated_at"]},
        headers=auth,
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "conflict"

    # Renaming the folder recomputes descendant paths
    renamed = await client.patch(f"{base}/folders/{projects_id}/rename", json={"name": "Work"}, headers=auth)
    assert renamed.status_code == 200
    moved_note = await client.get(f"{base}/notes/{note_data['id']}", headers=auth)
    assert moved_note.json()["data"]["path"] == "Work/Active/Nodum roadmap"

    # by-path lookup
    by_path = await client.get(f"{base}/notes/by-path", params={"path": "Work/Active/Nodum roadmap"}, headers=auth)
    assert by_path.status_code == 200

    # Move note to root
    to_root = await client.patch(f"{base}/notes/{note_data['id']}/rename", json={"move_to_root": True}, headers=auth)
    assert to_root.status_code == 200
    assert to_root.json()["data"]["path"] == "Nodum roadmap"

    # Folder move: Active under root
    folder_moved = await client.patch(f"{base}/folders/{active_id}/move", json={"new_parent_id": None}, headers=auth)
    assert folder_moved.status_code == 200
    assert folder_moved.json()["data"]["path"] == "Active"

    # Moving a folder into its own subtree is rejected
    child = await client.post(f"{base}/folders", json={"name": "Sub", "parent_id": active_id}, headers=auth)
    bad_move = await client.patch(
        f"{base}/folders/{active_id}/move",
        json={"new_parent_id": child.json()["data"]["id"]},
        headers=auth,
    )
    assert bad_move.status_code == 422

    # Delete folder cascades
    deleted = await client.delete(f"{base}/folders/{active_id}", headers=auth)
    assert deleted.status_code == 200

    # Tree reflects everything and includes the root note
    tree = await client.get(f"{base}/tree", headers=auth)
    items = tree.json()["data"]["items"]
    root_titles = {i.get("title") for i in items if i["type"] == "note"}
    assert "Nodum roadmap" in root_titles
