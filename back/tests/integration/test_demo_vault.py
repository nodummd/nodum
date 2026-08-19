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


async def test_two_demos_at_once_both_succeed(client: AsyncClient, account: dict) -> None:
    """Two tabs, one click each: the loser of the name race takes the next
    number instead of a 500."""
    import asyncio

    a, b = await asyncio.gather(
        client.post("/api/v1/vaults/demo", headers=account["headers"]),
        client.post("/api/v1/vaults/demo", headers=account["headers"]),
    )
    assert {a.status_code, b.status_code} == {201}, (a.text[:200], b.text[:200])
    names = {a.json()["data"]["vault"]["name"], b.json()["data"]["vault"]["name"]}
    assert names == {"Demo Workspace", "Demo Workspace 2"}, names


async def test_demo_daily_note_lands_beside_the_others(client: AsyncClient, account: dict) -> None:
    created = (await client.post("/api/v1/vaults/demo", headers=account["headers"])).json()["data"]
    vid = created["vault"]["id"]
    resp = await client.post(
        f"/api/v1/vaults/{vid}/daily-note", json={"now": "2026-08-19T09:30:00"}, headers=account["headers"]
    )
    assert resp.status_code == 200, resp.text
    note = resp.json()["data"]
    assert note["path"] == "Daily/2026-08-19"
    assert "Wednesday, 19 August 2026" in note["content"] and "09:30" in note["content"]
    assert "{{" not in note["content"]
    # The fixture's own daily notes are its siblings, not in a month subfolder.
    tree = (await client.get(f"/api/v1/vaults/{vid}/tree", headers=account["headers"])).json()["data"]
    daily = next(i for i in tree["items"] if i["type"] == "folder" and i["name"] == "Daily")
    assert all(c["type"] == "note" for c in daily["children"]), [
        c.get("name") for c in daily["children"] if c["type"] == "folder"
    ]
    assert any(c["title"] == "2026-08-01" for c in daily["children"])
