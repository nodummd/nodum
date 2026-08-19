"""Nodum as an MCP server, driven the way a client drives it: raw JSON-RPC
over Streamable HTTP with a bearer token.

What must hold: no token → 401; a revoked token stops working; the tools do
real work in the vault through the same rules as the app; and nothing crosses
between users.
"""

import base64
import uuid
from typing import Any

import pytest
from httpx import AsyncClient

MCP = "/api/v1/mcp"
ACCEPT = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


async def _signup(client: AsyncClient, prefix: str) -> dict:
    creds = {
        "email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "MCP Tester",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}


@pytest.fixture
async def account(client: AsyncClient) -> dict:
    session = await _signup(client, "mcp")
    minted = await client.post("/api/v1/mcp-tokens", json={"name": "test client"}, headers=session)
    assert minted.status_code == 201, minted.text
    data = minted.json()["data"]
    vaults = (await client.get("/api/v1/vaults", headers=session)).json()["data"]
    return {
        "session": session,
        "token": data["token"],
        "token_id": data["id"],
        "mcp": {**ACCEPT, "Authorization": f"Bearer {data['token']}"},
        "vault_id": vaults[0]["id"],
    }


async def rpc(client: AsyncClient, headers: dict, method: str, params: dict | None = None, id_: int = 1) -> Any:
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": id_, "method": method}
    if params is not None:
        body["params"] = params
    resp = await client.post(MCP, json=body, headers=headers)
    assert resp.status_code == 200, f"{method}: {resp.status_code} {resp.text[:300]}"
    return resp.json()


async def call(client: AsyncClient, headers: dict, tool: str, **arguments: Any) -> Any:
    """tools/call → structured result (or raise with the tool's message)."""
    out = await rpc(client, headers, "tools/call", {"name": tool, "arguments": arguments})
    result = out["result"]
    if result.get("isError"):
        raise AssertionError(f"{tool} failed: {result['content'][0]['text']}")
    if "structuredContent" in result:
        sc = result["structuredContent"]
        return sc.get("result", sc)
    return result["content"]


async def test_no_token_is_401_with_a_bearer_challenge(client: AsyncClient) -> None:
    resp = await client.post(MCP, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=ACCEPT)
    assert resp.status_code == 401
    assert "bearer" in resp.headers.get("www-authenticate", "").lower()
    bad = await client.post(
        MCP,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={**ACCEPT, "Authorization": "Bearer nodum_mcp_nope"},
    )
    assert bad.status_code == 401


async def test_initialize_and_tools_list(client: AsyncClient, account: dict) -> None:
    init = await rpc(
        client,
        account["mcp"],
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "0"}},
    )
    assert init["result"]["serverInfo"]["name"] == "nodum"
    assert "vault" in init["result"]["instructions"].lower()
    tools = (await rpc(client, account["mcp"], "tools/list"))["result"]["tools"]
    names = {t["name"] for t in tools}
    for expected in (
        "list_vaults",
        "create_vault",
        "get_tree",
        "create_folder",
        "list_notes",
        "search_notes",
        "read_note",
        "create_note",
        "update_note",
        "rename_note",
        "move_note",
        "delete_note",
        "link_notes",
        "get_backlinks",
        "get_graph",
        "set_item_color",
        "set_graph_groups",
        "import_markdown",
        "import_attachment",
        "export_vault",
        "set_note_tags",
        "daily_note",
    ):
        assert expected in names, expected
    assert len(tools) >= 30


async def test_a_full_session_of_vault_work(client: AsyncClient, account: dict) -> None:
    h = account["mcp"]
    vaults = await call(client, h, "list_vaults")
    assert vaults[0]["id"] == account["vault_id"]

    # A new vault, notes in a folder, links between them.
    vault = await call(client, h, "create_vault", name="Research")
    vid = vault["id"]
    folder = await call(client, h, "create_folder", vault_id=vid, path="Papers/2026")
    assert folder["path"] == "Papers/2026"

    a = await call(
        client,
        h,
        "create_note",
        vault_id=vid,
        title="Attention",
        content="Transformers attend. See [[Scaling]].",
        folder="Papers/2026",
    )
    b = await call(
        client,
        h,
        "create_note",
        vault_id=vid,
        title="Scaling",
        content="Bigger is better, up to a point.",
        folder="Papers/2026",
    )
    assert a["path"] == "Papers/2026/Attention" and b["path"] == "Papers/2026/Scaling"

    # The link in `a` resolved to `b`: backlinks on b, outgoing on a, an edge in the graph.
    back = await call(client, h, "get_backlinks", vault_id=vid, note="Scaling")
    assert [x["title"] for x in back["backlinks"]] == ["Attention"]
    graph = await call(client, h, "get_graph", vault_id=vid)
    assert len(graph["edges"]) == 1
    assert all(not n["unresolved"] for n in graph["nodes"])

    # link_notes appends a wikilink; update_note appends text; read_note sees both.
    await call(client, h, "link_notes", vault_id=vid, from_note="Scaling", to_note="Attention")
    await call(
        client,
        h,
        "update_note",
        vault_id=vid,
        note="Papers/2026/Scaling",
        content="Also: [[Attention]] is all you need.",
        mode="append",
    )
    read = await call(client, h, "read_note", vault_id=vid, note="Scaling")
    assert "[[Attention]]" in read["content"] and "Bigger is better" in read["content"]

    # Search, tags, colours, groups.
    hits = await call(client, h, "search_notes", vault_id=vid, query="transformers")
    assert hits[0]["title"] == "Attention"
    tagged = await call(client, h, "set_note_tags", vault_id=vid, note="Attention", add=["ml", "reading"])
    assert set(tagged["tags"]) >= {"ml", "reading"}
    tags = await call(client, h, "list_tags", vault_id=vid)
    assert {t["name"] for t in tags} >= {"ml", "reading"}
    colour = await call(client, h, "set_item_color", vault_id=vid, path="Papers", color="#4c8dff")
    assert colour["kind"] == "folder"
    colours = await call(client, h, "list_item_colors", vault_id=vid)
    assert colours[0]["path"] == "Papers" and colours[0]["color"] == "#4c8dff"
    groups = await call(client, h, "set_graph_groups", vault_id=vid, groups=[{"query": "tag:#ml", "color": "#eb3b5a"}])
    assert groups["groups"][0]["query"] == "tag:#ml"

    # Rename and move; the tree reflects it; export sees the files.
    await call(client, h, "rename_note", vault_id=vid, note="Scaling", new_title="Scaling laws")
    moved = await call(client, h, "move_note", vault_id=vid, note="Scaling laws", folder="Archive")
    assert moved["path"] == "Archive/Scaling laws"
    tree = await call(client, h, "get_tree", vault_id=vid)
    top = {i["name"] for i in tree["items"] if i["type"] == "folder"}
    assert {"Papers", "Archive"} <= top
    exported = await call(client, h, "export_vault", vault_id=vid)
    assert {f["path"] for f in exported["files"]} == {"Papers/2026/Attention.md", "Archive/Scaling laws.md"}
    zipped = await call(client, h, "export_vault", vault_id=vid, as_zip=True)
    assert base64.b64decode(zipped["zip_base64"])[:2] == b"PK"

    # Import several files at once — links between them resolve in one pass.
    imported = await call(
        client,
        h,
        "import_markdown",
        vault_id=vid,
        files=[
            {"path": "Ideas/One.md", "content": "Leads to [[Two]]."},
            {"path": "Ideas/Two.md", "content": "Came from [[One]]."},
        ],
    )
    assert imported["imported"] == 2
    # The paths given are the paths kept — no "wrapper folder" unwrapping here.
    listed = await call(client, h, "list_notes", vault_id=vid, folder="Ideas")
    assert sorted(n["path"] for n in listed) == ["Ideas/One", "Ideas/Two"], listed
    graph = await call(client, h, "get_graph", vault_id=vid)
    ghosts = {n["title"].lower() for n in graph["nodes"] if n["unresolved"]}
    assert not ghosts & {"one", "two"}, ghosts
    # (The rename above left [[Scaling]] in "Attention" pointing at the OLD
    # name — a ghost, exactly as the app shows it, so the person can see it.)

    # An attachment, embeddable.
    png = base64.b64encode(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5f0000000049454e44ae426082"
        )
    ).decode()
    att = await call(client, h, "import_attachment", vault_id=vid, filename="dot.png", content_base64=png)
    assert att["embed"] == "![[dot.png]]"

    # Bookmarks, daily note, delete.
    await call(client, h, "bookmark_note", vault_id=vid, note="Attention")
    assert [b["title"] for b in await call(client, h, "list_bookmarks", vault_id=vid)] == ["Attention"]
    daily = await call(client, h, "daily_note", vault_id=vid)
    assert daily["title"]
    gone = await call(client, h, "delete_note", vault_id=vid, note="Ideas/Two")
    assert gone["deleted"] is True

    # delete_vault demands confirmation and never deletes the last vault.
    with pytest.raises(AssertionError, match="confirm=true"):
        await call(client, h, "delete_vault", vault_id=vid)
    assert (await call(client, h, "delete_vault", vault_id=vid, confirm=True))["deleted"] is True


async def test_tools_never_cross_users(client: AsyncClient, account: dict) -> None:
    other_session = await _signup(client, "mcp-other")
    other_token = (await client.post("/api/v1/mcp-tokens", json={"name": "x"}, headers=other_session)).json()["data"][
        "token"
    ]
    other = {**ACCEPT, "Authorization": f"Bearer {other_token}"}
    # The other user's token cannot see or touch this account's vault.
    with pytest.raises(AssertionError, match=r"not found|No note"):
        await call(client, other, "list_notes", vault_id=account["vault_id"])
    with pytest.raises(AssertionError):
        await call(client, other, "create_note", vault_id=account["vault_id"], title="Intruder", content="x")


async def test_revoking_the_token_cuts_the_client_off(client: AsyncClient, account: dict) -> None:
    assert (await rpc(client, account["mcp"], "tools/list"))["result"]["tools"]
    revoked = await client.delete(f"/api/v1/mcp-tokens/{account['token_id']}", headers=account["session"])
    assert revoked.status_code == 200
    resp = await client.post(MCP, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=account["mcp"])
    assert resp.status_code == 401


async def test_token_list_never_shows_the_token(client: AsyncClient, account: dict) -> None:
    listed = await client.get("/api/v1/mcp-tokens", headers=account["session"])
    body = listed.json()["data"]
    assert account["token"] not in listed.text
    assert body["tokens"][0]["hint"] == account["token"][-4:]
    assert body["endpoint"].endswith("/api/v1/mcp")
