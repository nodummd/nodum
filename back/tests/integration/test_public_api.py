"""The public API (/api/public/v1), driven exactly as an external app drives it:
bearer key auth, scope enforcement, tenant isolation, and the whole surface.

What must hold: no key → 401 (sessions and MCP tokens do NOT work here); a
key does only what its scopes say; nothing crosses between users; and the
OpenAPI document is public and contains only public endpoints.
"""

import uuid

from httpx import AsyncClient

P = "/api/public/v1"


async def _signup(client: AsyncClient, prefix: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={"email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev", "password": "s3cure-Password!", "name": "P"},
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}


async def _mint(client: AsyncClient, session: dict, scopes: list[str], name: str = "test") -> dict:
    minted = await client.post("/api/v1/api-keys", json={"name": name, "scopes": scopes}, headers=session)
    assert minted.status_code == 201, minted.text
    data = minted.json()["data"]
    return {"key": data["token"], "key_id": data["id"], "headers": {"Authorization": f"Bearer {data['token']}"}}


async def _account(client: AsyncClient, prefix: str = "pub") -> dict:
    session = await _signup(client, prefix)
    full = await _mint(client, session, ["read", "write", "delete", "ai"])
    vaults = (await client.get("/api/v1/vaults", headers=session)).json()["data"]
    return {"session": session, **full, "vault_id": vaults[0]["id"]}


# ── Auth ─────────────────────────────────────────────────────────────────────


async def test_only_an_api_key_authenticates(client: AsyncClient) -> None:
    account = await _account(client)
    mcp = (await client.post("/api/v1/mcp-tokens", json={"name": "m"}, headers=account["session"])).json()["data"]

    for token in (None, "nodum_key_made-up", mcp["token"], account["session"]["Authorization"].split(" ", 1)[1]):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        resp = await client.get(f"{P}/vaults", headers=headers)
        assert resp.status_code == 401, (token, resp.text)
        assert resp.json()["error"]["code"] == "unauthorized"

    # …and the key does not work where the MCP token belongs.
    resp = await client.post(
        "/api/v1/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Accept": "application/json, text/event-stream", **account["headers"]},
    )
    assert resp.status_code == 401

    ok = await client.get(f"{P}/vaults", headers=account["headers"])
    assert ok.status_code == 200 and ok.json()["data"], ok.text


async def test_scopes_are_enforced(client: AsyncClient) -> None:
    account = await _account(client, "scopes")
    session, vault_id = account["session"], account["vault_id"]
    ro = await _mint(client, session, ["read"], "ro")

    assert (await client.get(f"{P}/vaults", headers=ro["headers"])).status_code == 200

    denied_write = await client.post(f"{P}/vaults/{vault_id}/notes", json={"title": "no"}, headers=ro["headers"])
    assert denied_write.status_code == 403 and "'write'" in denied_write.json()["error"]["message"]

    note = (
        await client.post(f"{P}/vaults/{vault_id}/notes", json={"title": "A note"}, headers=account["headers"])
    ).json()["data"]
    denied_delete = await client.delete(f"{P}/vaults/{vault_id}/notes/{note['id']}", headers=ro["headers"])
    assert denied_delete.status_code == 403 and "'delete'" in denied_delete.json()["error"]["message"]

    denied_ai = await client.post(f"{P}/vaults/{vault_id}/ai/ask", json={"message": "hi"}, headers=ro["headers"])
    assert denied_ai.status_code == 403 and "'ai'" in denied_ai.json()["error"]["message"]


async def test_never_crosses_users(client: AsyncClient) -> None:
    alice = await _account(client, "alice")
    bob = await _account(client, "bob")
    secret = f"top-secret-{uuid.uuid4().hex}"
    note = (
        await client.post(
            f"{P}/vaults/{alice['vault_id']}/notes",
            json={"title": "Private", "content": secret},
            headers=alice["headers"],
        )
    ).json()["data"]

    va, na = alice["vault_id"], note["id"]
    probes = [
        ("GET", f"{P}/vaults/{va}/notes", None),
        ("GET", f"{P}/vaults/{va}/notes/{na}", None),
        ("GET", f"{P}/vaults/{va}/search?q=top-secret", None),
        ("GET", f"{P}/vaults/{va}/tree", None),
        ("GET", f"{P}/vaults/{va}/graph", None),
        ("POST", f"{P}/vaults/{va}/notes", {"title": "intrusion"}),
        ("PUT", f"{P}/vaults/{va}/notes/{na}/content", {"content": "defaced"}),
        ("DELETE", f"{P}/vaults/{va}/notes/{na}", None),
    ]
    for method, url, body in probes:
        resp = await client.request(method, url, json=body, headers=bob["headers"])
        assert resp.status_code == 404, f"{method} {url}: {resp.status_code}"
        assert secret not in resp.text

    # Alice's vault is listed only for Alice, and her note is untouched.
    bobs_vaults = (await client.get(f"{P}/vaults", headers=bob["headers"])).json()["data"]
    assert va not in [v["id"] for v in bobs_vaults]
    kept = (await client.get(f"{P}/vaults/{va}/notes/{na}", headers=alice["headers"])).json()["data"]
    assert kept["content"] == secret


# ── The surface ──────────────────────────────────────────────────────────────


async def test_note_crud_roundtrip(client: AsyncClient) -> None:
    account = await _account(client, "crud")
    v, h = account["vault_id"], account["headers"]

    created = await client.post(
        f"{P}/vaults/{v}/notes",
        json={"title": "Alpha", "folder": "Projects/2026", "content": "---\ntags: [seed]\n---\nBody line."},
        headers=h,
    )
    assert created.status_code == 201, created.text
    note = created.json()["data"]
    assert note["path"] == "Projects/2026/Alpha"

    dup = await client.post(f"{P}/vaults/{v}/notes", json={"title": "Alpha", "folder": "Projects/2026"}, headers=h)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "already_exists"

    by_path = await client.get(f"{P}/vaults/{v}/notes/by-path", params={"path": "Projects/2026/Alpha"}, headers=h)
    assert by_path.status_code == 200 and by_path.json()["data"]["id"] == note["id"]

    appended = await client.put(
        f"{P}/vaults/{v}/notes/{note['id']}/content", json={"content": "The end.", "mode": "append"}, headers=h
    )
    assert appended.json()["data"]["content"].rstrip().endswith("The end.")

    prepended = await client.put(
        f"{P}/vaults/{v}/notes/{note['id']}/content", json={"content": "First.", "mode": "prepend"}, headers=h
    )
    content = prepended.json()["data"]["content"]
    assert content.startswith("---\n"), "prepend must stay below the frontmatter"
    assert content.index("First.") < content.index("Body line.")

    stale = await client.put(
        f"{P}/vaults/{v}/notes/{note['id']}/content",
        json={"content": "x", "base_updated_at": "2020-01-01T00:00:00Z"},
        headers=h,
    )
    assert stale.status_code == 409
    err = stale.json()["error"]
    assert err["code"] == "conflict" and err["details"]["server_updated_at"]

    moved = await client.patch(
        f"{P}/vaults/{v}/notes/{note['id']}", json={"title": "Alpha Two", "folder": "Archive"}, headers=h
    )
    assert moved.json()["data"]["path"] == "Archive/Alpha Two"
    rooted = await client.patch(f"{P}/vaults/{v}/notes/{note['id']}", json={"folder": ""}, headers=h)
    assert rooted.json()["data"]["path"] == "Alpha Two"

    deleted = await client.delete(f"{P}/vaults/{v}/notes/{note['id']}", headers=h)
    assert deleted.status_code == 200
    assert (await client.get(f"{P}/vaults/{v}/notes/{note['id']}", headers=h)).status_code == 404


async def test_list_and_search_paginate(client: AsyncClient) -> None:
    account = await _account(client, "page")
    v, h = account["vault_id"], account["headers"]
    for i in range(3):
        resp = await client.post(
            f"{P}/vaults/{v}/notes",
            json={"title": f"Pageable {i}", "folder": "Pages", "content": "zanzibar everywhere"},
            headers=h,
        )
        assert resp.status_code == 201

    first = (await client.get(f"{P}/vaults/{v}/notes", params={"folder": "Pages", "limit": 2}, headers=h)).json()[
        "data"
    ]
    assert first["total"] == 3 and len(first["items"]) == 2
    rest = (
        await client.get(f"{P}/vaults/{v}/notes", params={"folder": "Pages", "limit": 2, "offset": 2}, headers=h)
    ).json()["data"]
    assert rest["total"] == 3 and len(rest["items"]) == 1

    hits = (await client.get(f"{P}/vaults/{v}/search", params={"q": "zanzibar", "limit": 2}, headers=h)).json()["data"]
    assert hits["total"] == 3 and len(hits["results"]) == 2
    assert "<mark>" in hits["results"][0]["snippet"]
    more = (
        await client.get(f"{P}/vaults/{v}/search", params={"q": "zanzibar", "limit": 2, "offset": 2}, headers=h)
    ).json()["data"]
    assert more["total"] == 3 and len(more["results"]) == 1

    quick = (await client.get(f"{P}/vaults/{v}/quick-switch", params={"q": "Pageable"}, headers=h)).json()["data"]
    assert len(quick) == 3


async def test_link_backlinks_unlink(client: AsyncClient) -> None:
    account = await _account(client, "links")
    v, h = account["vault_id"], account["headers"]
    src = (await client.post(f"{P}/vaults/{v}/notes", json={"title": "Source"}, headers=h)).json()["data"]
    dst = (await client.post(f"{P}/vaults/{v}/notes", json={"title": "Target"}, headers=h)).json()["data"]

    linked = await client.post(f"{P}/vaults/{v}/notes/{src['id']}/links", json={"target": "Target"}, headers=h)
    assert linked.status_code == 201 and linked.json()["data"]["inserted"] == "- [[Target]]"

    again = await client.post(f"{P}/vaults/{v}/notes/{src['id']}/links", json={"target": dst["id"]}, headers=h)
    assert again.json()["data"]["already_linked"] is True and again.json()["data"]["inserted"] is None

    back = (await client.get(f"{P}/vaults/{v}/notes/{dst['id']}/backlinks", headers=h)).json()["data"]
    assert [b["title"] for b in back["backlinks"]] == ["Source"]
    out = (await client.get(f"{P}/vaults/{v}/notes/{src['id']}/links", headers=h)).json()["data"]
    assert [o["resolved_title"] for o in out["outgoing"]] == ["Target"]  # target_title is stored normalized

    self_link = await client.post(f"{P}/vaults/{v}/notes/{src['id']}/links", json={"target": "Source"}, headers=h)
    assert self_link.status_code == 422

    unlinked = await client.delete(f"{P}/vaults/{v}/notes/{src['id']}/links", params={"target": "Target"}, headers=h)
    assert unlinked.status_code == 200 and unlinked.json()["data"]["removed"] == 1
    assert (await client.get(f"{P}/vaults/{v}/notes/{dst['id']}/backlinks", headers=h)).json()["data"][
        "backlinks"
    ] == []
    body = (await client.get(f"{P}/vaults/{v}/notes/{src['id']}", headers=h)).json()["data"]["content"]
    assert "[[Target]]" not in body

    noop = await client.delete(f"{P}/vaults/{v}/notes/{src['id']}/links", params={"target": "Target"}, headers=h)
    assert noop.status_code == 200 and noop.json()["data"]["removed"] == 0, "already unlinked is success"


async def test_tags_and_graph(client: AsyncClient) -> None:
    account = await _account(client, "tags")
    v, h = account["vault_id"], account["headers"]
    a = (
        await client.post(f"{P}/vaults/{v}/notes", json={"title": "TagA", "content": "See [[TagB]]"}, headers=h)
    ).json()["data"]
    (await client.post(f"{P}/vaults/{v}/notes", json={"title": "TagB"}, headers=h)).json()

    tagged = await client.post(f"{P}/vaults/{v}/notes/{a['id']}/tags", json={"add": ["#projects/api"]}, headers=h)
    assert tagged.status_code == 200

    tags = (await client.get(f"{P}/vaults/{v}/tags", headers=h)).json()["data"]
    assert {"name": "projects/api", "count": 1} in tags
    nested = (await client.get(f"{P}/vaults/{v}/tags/projects/api", headers=h)).json()["data"]
    assert nested["name"] == "projects/api" and [n["id"] for n in nested["notes"]] == [a["id"]]
    prefix = (await client.get(f"{P}/vaults/{v}/tags/projects", headers=h)).json()["data"]
    assert [n["id"] for n in prefix["notes"]] == [a["id"]], "nested tags match by prefix"

    untagged = await client.post(f"{P}/vaults/{v}/notes/{a['id']}/tags", json={"remove": ["projects/api"]}, headers=h)
    assert untagged.status_code == 200

    graph = (await client.get(f"{P}/vaults/{v}/graph", headers=h)).json()["data"]
    titles = [n.get("title") for n in graph["nodes"]]
    assert "TagA" in titles and "TagB" in titles
    local = (await client.get(f"{P}/vaults/{v}/notes/{a['id']}/graph", params={"depth": 1}, headers=h)).json()["data"]
    assert local["center"] == a["id"] and len(local["nodes"]) >= 2


async def test_ai_ask_without_a_provider_is_404(client: AsyncClient) -> None:
    account = await _account(client, "ai")
    resp = await client.post(
        f"{P}/vaults/{account['vault_id']}/ai/ask", json={"message": "What is here?"}, headers=account["headers"]
    )
    assert resp.status_code == 404, resp.text
    assert "provider" in resp.json()["error"]["message"].lower()


# ── Lifecycle ────────────────────────────────────────────────────────────────


async def test_password_change_revokes_keys(client: AsyncClient) -> None:
    account = await _account(client, "pw")
    assert (await client.get(f"{P}/vaults", headers=account["headers"])).status_code == 200
    changed = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "s3cure-Password!", "new_password": "new-Password-123"},
        headers=account["session"],
    )
    assert changed.status_code == 200, changed.text
    gone = await client.get(f"{P}/vaults", headers=account["headers"])
    assert gone.status_code == 401, "a password change must cut every API key"


async def test_deactivated_account_key_stops_working(client: AsyncClient) -> None:
    from sqlalchemy import select

    from app.core.db import async_session_factory
    from app.models.auth import User

    email_prefix = f"deact-{uuid.uuid4().hex[:8]}"
    session = await _signup(client, email_prefix)
    minted = await _mint(client, session, ["read"])
    assert (await client.get(f"{P}/vaults", headers=minted["headers"])).status_code == 200

    async with async_session_factory() as db:
        user = await db.scalar(select(User).where(User.email.startswith(email_prefix)))
        assert user is not None
        user.is_active = False
        await db.commit()
        user_id = user.id
    try:
        assert (await client.get(f"{P}/vaults", headers=minted["headers"])).status_code == 401
    finally:
        async with async_session_factory() as db:
            user = await db.get(User, user_id)
            assert user is not None
            user.is_active = True
            await db.commit()


async def test_openapi_is_public_and_only_public(client: AsyncClient) -> None:
    resp = await client.get(f"{P}/openapi.json")
    assert resp.status_code == 200
    spec = resp.json()
    assert "ApiKey" in spec["components"]["securitySchemes"]
    assert spec["servers"] == [{"url": "/api/public/v1"}]
    assert not [p for p in spec["paths"] if p.startswith("/api/v1")], "internal endpoints must not leak"
    # Every operation is padlocked (declares the ApiKey security requirement).
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            assert {"ApiKey": []} in op.get("security", []), f"{method.upper()} {path} lacks security"
    assert (await client.get(f"{P}/docs")).status_code == 200
