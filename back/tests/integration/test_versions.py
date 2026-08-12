"""Note version history — snapshot on save, throttling, restore round-trip."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"ver-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Version Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {"headers": headers, "vault_id": vaults[0]["id"]}


async def _setup_note(client: AsyncClient, ws: dict) -> tuple[str, str]:
    resp = await client.post(
        f"/api/v1/vaults/{ws['vault_id']}/notes",
        json={"title": "Versioned", "content": "Draft one."},
        headers=ws["headers"],
    )
    assert resp.status_code == 201, resp.text
    note_id = resp.json()["data"]["id"]
    return f"/api/v1/vaults/{ws['vault_id']}/notes/{note_id}", note_id


async def test_first_edit_snapshots_and_interval_throttles(client: AsyncClient, workspace: dict) -> None:
    base, _ = await _setup_note(client, workspace)
    h = workspace["headers"]

    # First edit → previous content snapshotted (no prior versions to throttle on)
    r = await client.put(f"{base}/content", json={"content": "Draft two."}, headers=h)
    assert r.status_code == 200, r.text
    versions = (await client.get(f"{base}/versions", headers=h)).json()["data"]
    assert len(versions) == 1

    # Immediate second edit → throttled by the snapshot interval
    r = await client.put(f"{base}/content", json={"content": "Draft three."}, headers=h)
    assert r.status_code == 200
    versions = (await client.get(f"{base}/versions", headers=h)).json()["data"]
    assert len(versions) == 1

    # Unchanged content → never snapshots
    r = await client.put(f"{base}/content", json={"content": "Draft three."}, headers=h)
    assert r.status_code == 200
    assert len((await client.get(f"{base}/versions", headers=h)).json()["data"]) == 1

    # The stored snapshot is the pre-edit content
    detail = (await client.get(f"{base}/versions/{versions[0]['id']}", headers=h)).json()["data"]
    assert detail["content"] == "Draft one."
    assert detail["title"] == "Versioned"


async def test_restore_round_trip(client: AsyncClient, workspace: dict) -> None:
    base, _ = await _setup_note(client, workspace)
    h = workspace["headers"]

    r = await client.put(f"{base}/content", json={"content": "Overwritten badly."}, headers=h)
    assert r.status_code == 200
    versions = (await client.get(f"{base}/versions", headers=h)).json()["data"]
    v1 = versions[0]["id"]

    restored = await client.post(f"{base}/versions/{v1}/restore", headers=h)
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"]["content"] == "Draft one."

    # The pre-restore content was snapshotted (restore is reversible)
    versions = (await client.get(f"{base}/versions", headers=h)).json()["data"]
    assert len(versions) == 2
    newest = (await client.get(f"{base}/versions/{versions[0]['id']}", headers=h)).json()["data"]
    assert newest["content"] == "Overwritten badly."


async def test_restore_resyncs_links(client: AsyncClient, workspace: dict) -> None:
    base, _note_id = await _setup_note(client, workspace)
    h = workspace["headers"]
    vault = workspace["vault_id"]

    r = await client.put(f"{base}/content", json={"content": "Linking [[Versioned target]]."}, headers=h)
    assert r.status_code == 200
    target = await client.post(
        f"/api/v1/vaults/{vault}/notes",
        json={"title": "Versioned target", "content": "The target."},
        headers=h,
    )
    target_id = target.json()["data"]["id"]

    backs = (await client.get(f"/api/v1/vaults/{vault}/notes/{target_id}/backlinks", headers=h)).json()
    assert any(b["title"] == "Versioned" for b in backs["data"]["backlinks"])

    # Restore to the pre-link snapshot → the backlink disappears
    versions = (await client.get(f"{base}/versions", headers=h)).json()["data"]
    oldest = versions[-1]["id"]
    restored = await client.post(f"{base}/versions/{oldest}/restore", headers=h)
    assert restored.status_code == 200
    backs = (await client.get(f"/api/v1/vaults/{vault}/notes/{target_id}/backlinks", headers=h)).json()
    assert not any(b["title"] == "Versioned" for b in backs["data"]["backlinks"])
