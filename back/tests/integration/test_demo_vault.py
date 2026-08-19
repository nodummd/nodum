"""The Demo Workspace: a populated vault created on request.

What must hold: it is a real import (links resolve, tags sync), the folder
colours and graph groups from the manifest are applied, and creating it twice
never collides on the name.
"""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def account(client: AsyncClient) -> dict:
    creds = {
        "email": f"demo-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "Demo Tester",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return {"headers": {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}}


async def test_describe_is_public_and_says_what_it_is(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/vaults/demo")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["name"] == "Demo Workspace"
    assert data["note_count"] > 150
    assert "linked" in data["description"]


async def test_creates_a_populated_coloured_vault(client: AsyncClient, account: dict) -> None:
    headers = account["headers"]
    resp = await client.post("/api/v1/vaults/demo", headers=headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]
    vault = data["vault"]
    assert vault["name"] == "Demo Workspace"
    assert data["imported"] > 150
    assert data["open_note_id"], "the Home note should be there to open first"

    # Manifest → settings: colours mapped onto the real folder ids, groups as-is.
    settings = vault["settings"]
    assert settings["demo"] is True
    assert len(settings["graph"]["groups"]) == 13
    tree = (await client.get(f"/api/v1/vaults/{vault['id']}/tree", headers=headers)).json()["data"]
    books = next(i for i in tree["items"] if i["type"] == "folder" and i["name"] == "Books")
    assert settings["itemColors"][books["id"]] == "#20bf6b"
    areas = next(i for i in tree["items"] if i["type"] == "folder" and i["name"] == "Areas")
    health = next(i for i in areas["children"] if i["type"] == "folder" and i["name"] == "Health")
    assert settings["itemColors"][health["id"]] == "#8854d0"

    # A real import: the demo's own links resolve to its own notes.
    graph = (await client.get(f"/api/v1/vaults/{vault['id']}/graph", headers=headers)).json()["data"]
    titles = {n["title"] for n in graph["nodes"] if not n["unresolved"]}
    assert "Home" in titles and "Health MOC" in titles
    ghosts = [n["title"] for n in graph["nodes"] if n["unresolved"]]
    assert ghosts == [], f"demo links that do not resolve: {ghosts[:10]}"
    assert len(graph["edges"]) > 300

    # And tags synced, so the graph groups have something to colour.
    tags = (await client.get(f"/api/v1/vaults/{vault['id']}/tags", headers=headers)).json()["data"]
    assert any(t["name"] == "cs" for t in tags)


async def test_a_second_demo_gets_a_numbered_name(client: AsyncClient, account: dict) -> None:
    headers = account["headers"]
    first = await client.post("/api/v1/vaults/demo", headers=headers)
    second = await client.post("/api/v1/vaults/demo", headers=headers)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["data"]["vault"]["name"] == "Demo Workspace"
    assert second.json()["data"]["vault"]["name"] == "Demo Workspace 2"


async def test_requires_authentication(client: AsyncClient) -> None:
    assert (await client.post("/api/v1/vaults/demo")).status_code == 401
