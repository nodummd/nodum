"""Link extraction, backlinks, and graph integration tests."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    """Fresh user + their default vault id + auth headers."""
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"links-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Link Tester",
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


async def test_welcome_vault_has_graph_edges(client: AsyncClient, workspace: dict) -> None:
    """The seeded vault must already demo the graph (welcome notes interlink)."""
    resp = await client.get(f"/api/v1/vaults/{workspace['vault_id']}/graph", headers=workspace["headers"])
    assert resp.status_code == 200
    graph = resp.json()["data"]
    assert len(graph["nodes"]) >= 3
    assert len(graph["edges"]) >= 2
    # The seeded [[My first idea]] link is unresolved → ghost node
    assert any(n["unresolved"] for n in graph["nodes"])


async def test_backlinks_and_outgoing(client: AsyncClient, workspace: dict) -> None:
    target = await _create(client, workspace, "Hub note", "The hub.")
    await _create(client, workspace, "Spoke A", "Links to [[Hub note]] twice: [[Hub note|the hub]].")
    await _create(client, workspace, "Spoke B", "Also references [[Hub note]] and embeds ![[Hub note]].")

    base = f"/api/v1/vaults/{workspace['vault_id']}"
    back = await client.get(f"{base}/notes/{target['id']}/backlinks", headers=workspace["headers"])
    assert back.status_code == 200
    backlinks = back.json()["data"]["backlinks"]
    titles = {b["title"]: b for b in backlinks}
    assert set(titles) == {"Spoke A", "Spoke B"}
    assert titles["Spoke A"]["count"] == 2
    assert titles["Spoke A"]["snippets"]

    spoke_a_id = titles["Spoke A"]["note_id"]
    out = await client.get(f"{base}/notes/{spoke_a_id}/outgoing", headers=workspace["headers"])
    assert out.status_code == 200
    outgoing = out.json()["data"]["outgoing"]
    assert len(outgoing) == 1
    assert outgoing[0]["resolved_title"] == "Hub note"
    assert outgoing[0]["count"] == 2


async def test_unresolved_link_resolves_when_note_created(client: AsyncClient, workspace: dict) -> None:
    src = await _create(client, workspace, "Pointer", "See [[Future Note]].")
    base = f"/api/v1/vaults/{workspace['vault_id']}"

    out = await client.get(f"{base}/notes/{src['id']}/outgoing", headers=workspace["headers"])
    assert out.json()["data"]["outgoing"][0]["target_note_id"] is None

    created = await _create(client, workspace, "Future Note", "Now I exist.")

    out2 = await client.get(f"{base}/notes/{src['id']}/outgoing", headers=workspace["headers"])
    assert out2.json()["data"]["outgoing"][0]["target_note_id"] == created["id"]

    back = await client.get(f"{base}/notes/{created['id']}/backlinks", headers=workspace["headers"])
    assert [b["title"] for b in back.json()["data"]["backlinks"]] == ["Pointer"]


async def test_rename_unresolves_and_reresolves(client: AsyncClient, workspace: dict) -> None:
    target = await _create(client, workspace, "Old Name", "content")
    await _create(client, workspace, "Referrer", "Link: [[Old Name]]")
    base = f"/api/v1/vaults/{workspace['vault_id']}"

    renamed = await client.patch(
        f"{base}/notes/{target['id']}/rename", json={"title": "New Name"}, headers=workspace["headers"]
    )
    assert renamed.status_code == 200

    # Old-name links become unresolved (we never rewrite user markdown silently)
    back = await client.get(f"{base}/notes/{target['id']}/backlinks", headers=workspace["headers"])
    assert back.json()["data"]["backlinks"] == []

    # A new note claiming the old name inherits the link
    reclaimed = await _create(client, workspace, "Old Name", "reborn")
    back2 = await client.get(f"{base}/notes/{reclaimed['id']}/backlinks", headers=workspace["headers"])
    assert [b["title"] for b in back2.json()["data"]["backlinks"]] == ["Referrer"]


async def test_deleting_target_makes_ghost(client: AsyncClient, workspace: dict) -> None:
    target = await _create(client, workspace, "Doomed", "bye")
    await _create(client, workspace, "Survivor", "Points at [[Doomed]]")
    base = f"/api/v1/vaults/{workspace['vault_id']}"

    assert (await client.delete(f"{base}/notes/{target['id']}", headers=workspace["headers"])).status_code == 200

    graph = (await client.get(f"{base}/graph", headers=workspace["headers"])).json()["data"]
    ghosts = [n for n in graph["nodes"] if n["unresolved"]]
    assert any(n["title"] == "doomed" for n in ghosts)


async def test_unlinked_mentions(client: AsyncClient, workspace: dict) -> None:
    target = await _create(client, workspace, "Zettelkasten", "the method")
    await _create(client, workspace, "Essay", "I have been reading about Zettelkasten lately.")
    await _create(client, workspace, "Linked already", "Proper link: [[Zettelkasten]]")
    base = f"/api/v1/vaults/{workspace['vault_id']}"

    resp = await client.get(f"{base}/notes/{target['id']}/unlinked-mentions", headers=workspace["headers"])
    assert resp.status_code == 200
    mentions = resp.json()["data"]["unlinked_mentions"]
    assert [m["title"] for m in mentions] == ["Essay"]


async def test_local_graph_depth(client: AsyncClient, workspace: dict) -> None:
    a = await _create(client, workspace, "A", "[[B]]")
    await _create(client, workspace, "B", "[[C]]")
    await _create(client, workspace, "C", "[[D]]")
    await _create(client, workspace, "D", "end")
    base = f"/api/v1/vaults/{workspace['vault_id']}"

    d1 = (await client.get(f"{base}/notes/{a['id']}/local-graph?depth=1", headers=workspace["headers"])).json()["data"]
    titles_d1 = {n["title"] for n in d1["nodes"]}
    assert titles_d1 == {"A", "B"}

    d3 = (await client.get(f"{base}/notes/{a['id']}/local-graph?depth=3", headers=workspace["headers"])).json()["data"]
    titles_d3 = {n["title"] for n in d3["nodes"]}
    assert {"A", "B", "C", "D"} <= titles_d3


async def test_graph_cache_invalidation(client: AsyncClient, workspace: dict) -> None:
    base = f"/api/v1/vaults/{workspace['vault_id']}"
    g1 = (await client.get(f"{base}/graph", headers=workspace["headers"])).json()["data"]
    n_nodes = len(g1["nodes"])

    await _create(client, workspace, "Cache Buster", "[[Welcome to Nodum]]")

    g2 = (await client.get(f"{base}/graph", headers=workspace["headers"])).json()["data"]
    assert len(g2["nodes"]) == n_nodes + 1


async def test_folder_rename_reresolves_path_links(client: AsyncClient, workspace: dict) -> None:
    """Path-addressed wikilinks follow Obsidian semantics through folder renames."""
    base = f"/api/v1/vaults/{workspace['vault_id']}"
    folder = await client.post(f"{base}/folders", json={"name": "Docs"}, headers=workspace["headers"])
    folder_id = folder.json()["data"]["id"]

    resp = await client.post(
        f"{base}/notes",
        json={"title": "Spec", "folder_id": folder_id},
        headers=workspace["headers"],
    )
    target_id = resp.json()["data"]["id"]
    await _create(client, workspace, "Pointer note", "See [[Docs/Spec]].")

    back1 = await client.get(f"{base}/notes/{target_id}/backlinks", headers=workspace["headers"])
    assert [b["title"] for b in back1.json()["data"]["backlinks"]] == ["Pointer note"]

    # Rename the folder: the old path-link unresolves (we never rewrite markdown)
    renamed = await client.patch(
        f"{base}/folders/{folder_id}/rename", json={"name": "Archive"}, headers=workspace["headers"]
    )
    assert renamed.status_code == 200
    back2 = await client.get(f"{base}/notes/{target_id}/backlinks", headers=workspace["headers"])
    assert back2.json()["data"]["backlinks"] == []

    # A link written against the new path resolves immediately
    await _create(client, workspace, "Fresh pointer", "Now [[Archive/Spec]].")
    back3 = await client.get(f"{base}/notes/{target_id}/backlinks", headers=workspace["headers"])
    assert [b["title"] for b in back3.json()["data"]["backlinks"]] == ["Fresh pointer"]


async def test_backlinks_counts_and_ordering_survive_the_two_query_split(client: AsyncClient, workspace: dict) -> None:
    """Backlinks now select sources first and bodies second, capped in SQL.

    Previously one query pulled every linking note's full body and applied
    MAX_BACKLINK_SOURCES in Python — a hub note transferred thousands of bodies
    to render a 200-entry panel. This pins the behaviour the split must keep:
    per-source link counts are summed, and sources come back title-ordered.
    """
    headers = workspace["headers"]
    base = f"/api/v1/vaults/{workspace['vault_id']}"

    hub = await _create(client, workspace, "Hub", "hub\n")
    # Zebra links to Hub twice, Alpha once — counts must aggregate per source.
    await _create(client, workspace, "Zebra", "see [[Hub]] and again [[Hub]]\n")
    await _create(client, workspace, "Alpha", "see [[Hub]]\n")

    body = (await client.get(f"{base}/notes/{hub['id']}/backlinks", headers=headers)).json()["data"]

    titles = [b["title"] for b in body["backlinks"]]
    assert titles == sorted(titles), f"sources must come back title-ordered: {titles}"
    counts = {b["title"]: b["count"] for b in body["backlinks"]}
    assert counts["Zebra"] == 2, f"link counts not summed per source: {counts}"
    assert counts["Alpha"] == 1
    # Snippets and path still come from the source body, fetched separately now.
    zebra = next(b for b in body["backlinks"] if b["title"] == "Zebra")
    assert zebra["snippets"], "snippet lost when bodies moved to the second query"
    assert zebra["path"], "path lost when it moved to the second query"
