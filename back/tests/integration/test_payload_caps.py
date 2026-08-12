"""Payload caps — tree/graph/backlinks degrade gracefully with truncated markers."""

import uuid

import pytest
from httpx import AsyncClient

from app.constants import limits


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"caps-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Caps Tester",
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


def _count_notes(items: list[dict]) -> int:
    total = 0
    for item in items:
        if item["type"] == "note":
            total += 1
        else:
            total += _count_notes(item["children"])
    return total


async def test_tree_caps_and_marks_truncated(
    client: AsyncClient, workspace: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limits, "MAX_TREE_ITEMS", 2)
    resp = await client.get(f"/api/v1/vaults/{workspace['vault_id']}/tree", headers=workspace["headers"])
    assert resp.status_code == 200
    tree = resp.json()["data"]
    assert tree["truncated"] is True
    assert _count_notes(tree["items"]) == 2  # welcome vault seeds 3 notes


async def test_graph_caps_nodes_and_ghosts(
    client: AsyncClient, workspace: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limits, "MAX_GRAPH_NODES", 2)
    resp = await client.get(f"/api/v1/vaults/{workspace['vault_id']}/graph", headers=workspace["headers"])
    assert resp.status_code == 200
    graph = resp.json()["data"]
    assert graph["truncated"] is True
    assert len(graph["nodes"]) <= 2
    # every edge references only surviving node indices
    assert all(s < len(graph["nodes"]) and t < len(graph["nodes"]) for s, t in graph["edges"])


async def test_backlinks_cap_sources(client: AsyncClient, workspace: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(limits, "MAX_BACKLINK_SOURCES", 1)
    target = await _create(client, workspace, "Popular", "Everyone links here.")
    await _create(client, workspace, "Fan one", "Love [[Popular]].")
    await _create(client, workspace, "Fan two", "Also [[Popular]].")

    resp = await client.get(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{target['id']}/backlinks",
        headers=workspace["headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["truncated"] is True
    assert len(data["backlinks"]) == 1


async def test_unlinked_mentions_scan_is_time_bounded(
    client: AsyncClient, workspace: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pane must answer 200 with a valid shape whether or not the local
    statement timeout cancels the scan (tiny budget exercises SET LOCAL)."""
    monkeypatch.setattr(limits, "UNLINKED_MENTIONS_TIMEOUT_MS", 1)
    target = await _create(client, workspace, "Mentioned", "The mentioned one.")
    await _create(client, workspace, "Mentioner", "I talk about Mentioned without linking.")

    resp = await client.get(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{target['id']}/unlinked-mentions",
        headers=workspace["headers"],
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert isinstance(data["unlinked_mentions"], list)

    # A normal budget returns the mention and the session stays usable
    monkeypatch.setattr(limits, "UNLINKED_MENTIONS_TIMEOUT_MS", 2000)
    resp = await client.get(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{target['id']}/unlinked-mentions",
        headers=workspace["headers"],
    )
    assert resp.status_code == 200
    titles = {m["title"] for m in resp.json()["data"]["unlinked_mentions"]}
    assert "Mentioner" in titles
