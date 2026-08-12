"""Search + tags integration tests."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"search-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Search Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    ws = {"headers": headers, "vault_id": vault_id, "base": f"/api/v1/vaults/{vault_id}"}

    async def create(title: str, content: str = "", folder_id: str | None = None) -> dict:
        r = await client.post(
            f"{ws['base']}/notes",
            json={"title": title, "content": content, "folder_id": folder_id},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        return r.json()["data"]

    ws["create"] = create
    return ws


async def test_fulltext_search_ranks_and_highlights(client: AsyncClient, workspace: dict) -> None:
    await workspace["create"]("Espresso guide", "Grinding espresso beans finely is essential for espresso.")
    await workspace["create"]("Tea notes", "Green tea steeping temperatures matter more than you think.")

    resp = await client.get(f"{workspace['base']}/search", params={"q": "espresso"}, headers=workspace["headers"])
    assert resp.status_code == 200
    results = resp.json()["data"]["results"]
    assert results, "espresso note should be found"
    assert results[0]["title"] == "Espresso guide"
    assert "<mark>" in results[0]["snippet"]
    assert all(r["title"] != "Tea notes" for r in results)


async def test_search_operators(client: AsyncClient, workspace: dict) -> None:
    folder = await client.post(f"{workspace['base']}/folders", json={"name": "Recipes"}, headers=workspace["headers"])
    folder_id = folder.json()["data"]["id"]
    await workspace["create"]("Pasta", "Boil water with salt. #cooking/italian", folder_id)
    await workspace["create"]("Water systems", "Municipal water treatment overview.")

    # path: operator restricts to the folder
    r1 = await client.get(
        f"{workspace['base']}/search", params={"q": "water path:Recipes"}, headers=workspace["headers"]
    )
    titles1 = [r["title"] for r in r1.json()["data"]["results"]]
    assert titles1 == ["Pasta"]

    # tag: operator with nested prefix matching
    r2 = await client.get(
        f"{workspace['base']}/search", params={"q": "water tag:cooking"}, headers=workspace["headers"]
    )
    titles2 = [r["title"] for r in r2.json()["data"]["results"]]
    assert titles2 == ["Pasta"]

    # file: operator alone (no text query)
    r3 = await client.get(f"{workspace['base']}/search", params={"q": "file:Water"}, headers=workspace["headers"])
    titles3 = [r["title"] for r in r3.json()["data"]["results"]]
    assert titles3 == ["Water systems"]


async def test_quick_switch_fuzzy_and_recents(client: AsyncClient, workspace: dict) -> None:
    await workspace["create"]("Project Phoenix", "rising")
    await workspace["create"]("Phone budget", "numbers")

    fuzzy = await client.get(f"{workspace['base']}/quick-switch", params={"q": "phoen"}, headers=workspace["headers"])
    assert fuzzy.status_code == 200
    titles = [r["title"] for r in fuzzy.json()["data"]]
    assert titles and titles[0] == "Project Phoenix"

    recents = await client.get(f"{workspace['base']}/quick-switch", headers=workspace["headers"])
    assert recents.status_code == 200
    assert [r["title"] for r in recents.json()["data"]][:2] == ["Phone budget", "Project Phoenix"]


async def test_tag_pane_counts_and_nested(client: AsyncClient, workspace: dict) -> None:
    await workspace["create"]("N1", "#projects/nodum work")
    await workspace["create"]("N2", "---\ntags: [projects/nodum, ideas]\n---\nbody")
    await workspace["create"]("N3", "#ideas only")

    tags = await client.get(f"{workspace['base']}/tags", headers=workspace["headers"])
    assert tags.status_code == 200
    by_name = {t["name"]: t["count"] for t in tags.json()["data"]}
    assert by_name["projects/nodum"] == 2
    assert by_name["ideas"] == 2  # frontmatter + inline
    # seeded welcome notes contribute getting-started tags too
    assert "getting-started" in by_name

    nested = await client.get(f"{workspace['base']}/tags/projects/notes", headers=workspace["headers"])
    assert nested.status_code == 200
    assert {n["title"] for n in nested.json()["data"]} == {"N1", "N2"}


async def test_tag_removed_when_note_updated(client: AsyncClient, workspace: dict) -> None:
    note = await workspace["create"]("Mutable", "#temporary tag here")
    updated = await client.put(
        f"{workspace['base']}/notes/{note['id']}/content",
        json={"content": "no tags anymore"},
        headers=workspace["headers"],
    )
    assert updated.status_code == 200

    tags = await client.get(f"{workspace['base']}/tags", headers=workspace["headers"])
    assert "temporary" not in {t["name"] for t in tags.json()["data"]}


async def test_graph_nodes_carry_tags(client: AsyncClient, workspace: dict) -> None:
    await workspace["create"]("Tagged node", "#graph/test content [[Welcome to Nodum]]")
    graph = (await client.get(f"{workspace['base']}/graph", headers=workspace["headers"])).json()["data"]
    node = next(n for n in graph["nodes"] if n["title"] == "Tagged node")
    assert "graph/test" in node["tags"]
