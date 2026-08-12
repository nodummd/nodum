"""Bookmark integration tests."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"bm-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "BM Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    return {"headers": headers, "base": f"/api/v1/vaults/{vault_id}"}


async def test_bookmark_lifecycle(client: AsyncClient, workspace: dict) -> None:
    tree = await client.get(f"{workspace['base']}/tree", headers=workspace["headers"])
    note = next(i for i in tree.json()["data"]["items"] if i["type"] == "note")

    # star (idempotent)
    for _ in range(2):
        added = await client.put(
            f"{workspace['base']}/bookmarks/{note['id']}", headers=workspace["headers"]
        )
        assert added.status_code == 201

    listed = await client.get(f"{workspace['base']}/bookmarks", headers=workspace["headers"])
    assert [b["title"] for b in listed.json()["data"]] == [note["title"]]

    removed = await client.delete(
        f"{workspace['base']}/bookmarks/{note['id']}", headers=workspace["headers"]
    )
    assert removed.status_code == 200
    assert (await client.get(f"{workspace['base']}/bookmarks", headers=workspace["headers"])).json()[
        "data"
    ] == []
