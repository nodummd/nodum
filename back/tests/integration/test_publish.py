"""Publish integration tests."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"pub-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Pub Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    return {"headers": headers, "base": f"/api/v1/vaults/{vault_id}"}


async def test_publish_public_read_unpublish(client: AsyncClient, workspace: dict) -> None:
    note = await client.post(
        f"{workspace['base']}/notes",
        json={"title": "Public essay", "content": "# Hello world\n\nShared thoughts."},
        headers=workspace["headers"],
    )
    note_id = note.json()["data"]["id"]

    # Publish (idempotent → same token)
    p1 = await client.post(f"{workspace['base']}/notes/{note_id}/publish", headers=workspace["headers"])
    assert p1.status_code == 201
    token = p1.json()["data"]["token"]
    p2 = await client.post(f"{workspace['base']}/notes/{note_id}/publish", headers=workspace["headers"])
    assert p2.json()["data"]["token"] == token

    # Status reflects it
    status = await client.get(f"{workspace['base']}/notes/{note_id}/publish", headers=workspace["headers"])
    assert status.json()["data"] == {"published": True, "token": token}

    # PUBLIC read — explicitly no Authorization header
    public = await client.get(f"/api/v1/public/{token}")
    assert public.status_code == 200, public.text
    body = public.json()["data"]
    assert body["title"] == "Public essay"
    assert "Shared thoughts." in body["content"]

    # Unknown token → 404
    assert (await client.get("/api/v1/public/not-a-real-token")).status_code == 404

    # Unpublish → public link dies
    un = await client.delete(f"{workspace['base']}/notes/{note_id}/publish", headers=workspace["headers"])
    assert un.status_code == 200
    assert (await client.get(f"/api/v1/public/{token}")).status_code == 404


async def test_publish_requires_ownership(client: AsyncClient, workspace: dict) -> None:
    note = await client.post(
        f"{workspace['base']}/notes", json={"title": "Private"}, headers=workspace["headers"]
    )
    note_id = note.json()["data"]["id"]

    other = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"pub-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Other",
        },
    )
    client.cookies.clear()
    other_headers = {"Authorization": f"Bearer {other.json()['data']['access_token']}"}
    resp = await client.post(f"{workspace['base']}/notes/{note_id}/publish", headers=other_headers)
    assert resp.status_code == 404
