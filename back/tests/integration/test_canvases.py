"""Canvas boards — CRUD, data round-trip, validation caps."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"canvas-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Canvas Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {"headers": headers, "base": f"/api/v1/vaults/{vaults[0]['id']}/canvases"}


async def test_canvas_crud_round_trip(client: AsyncClient, workspace: dict) -> None:
    h, base = workspace["headers"], workspace["base"]
    created = await client.post(base, json={"name": "Plan board"}, headers=h)
    assert created.status_code == 201, created.text
    cid = created.json()["data"]["id"]
    assert created.json()["data"]["data"] == {"nodes": [], "edges": []}

    data = {
        "nodes": [
            {"id": "a", "type": "text", "x": 0, "y": 0, "width": 250, "height": 120, "text": "# Idea"},
            {"id": "b", "type": "file", "x": 400, "y": 60, "width": 300, "height": 200, "file": "Welcome to Nodum"},
        ],
        "edges": [{"id": "e1", "fromNode": "a", "toNode": "b", "fromSide": "right", "toSide": "left"}],
    }
    put = await client.put(f"{base}/{cid}/data", json={"data": data}, headers=h)
    assert put.status_code == 200, put.text

    got = await client.get(f"{base}/{cid}", headers=h)
    assert got.json()["data"]["data"] == data

    listed = await client.get(base, headers=h)
    assert [c["name"] for c in listed.json()["data"]] == ["Plan board"]

    renamed = await client.patch(f"{base}/{cid}/rename", json={"name": "Roadmap"}, headers=h)
    assert renamed.json()["data"]["name"] == "Roadmap"

    deleted = await client.delete(f"{base}/{cid}", headers=h)
    assert deleted.status_code == 200
    assert (await client.get(f"{base}/{cid}", headers=h)).status_code == 404


async def test_canvas_validation(client: AsyncClient, workspace: dict) -> None:
    h, base = workspace["headers"], workspace["base"]
    cid = (await client.post(base, json={"name": "V"}, headers=h)).json()["data"]["id"]

    bad = await client.put(f"{base}/{cid}/data", json={"data": {"nodes": "nope"}}, headers=h)
    assert bad.status_code == 422

    too_many = {
        "nodes": [
            {"id": str(i), "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": ""} for i in range(501)
        ],
        "edges": [],
    }
    capped = await client.put(f"{base}/{cid}/data", json={"data": too_many}, headers=h)
    assert capped.status_code == 422

    dup = await client.post(base, json={"name": "V"}, headers=h)
    assert dup.status_code == 409
