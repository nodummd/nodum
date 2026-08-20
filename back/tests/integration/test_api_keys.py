"""API keys (Settings → API keys): mint, list, revoke — the management side.

The keys' consumer side (the public API itself) is tests/integration/test_public_api.py.
"""

import re
import uuid

from httpx import AsyncClient

KEY_RE = re.compile(r"^nodum_key_[A-Za-z0-9_-]{40,}$")


async def _signup(client: AsyncClient, prefix: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={"email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev", "password": "s3cure-Password!", "name": "K"},
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}


async def test_mint_list_revoke(client: AsyncClient) -> None:
    session = await _signup(client, "keys")

    minted = await client.post(
        "/api/v1/api-keys", json={"name": "CI script", "scopes": ["write", "read", "READ"]}, headers=session
    )
    assert minted.status_code == 201, minted.text
    data = minted.json()["data"]
    assert KEY_RE.match(data["token"]), data["token"]
    assert data["kind"] == "key"
    assert data["scopes"] == ["read", "write"], "canonical order, deduplicated, case-insensitive"
    assert data["base_url"].endswith("/api/public/v1")

    listed = (await client.get("/api/v1/api-keys", headers=session)).json()["data"]
    assert listed["base_url"].endswith("/api/public/v1")
    (row,) = listed["keys"]
    assert row["name"] == "CI script" and row["hint"] == data["token"][-4:]
    assert "token" not in row, "the plaintext exists in the mint response only"

    revoked = await client.delete(f"/api/v1/api-keys/{data['id']}", headers=session)
    assert revoked.status_code == 200 and revoked.json()["data"]["revoked_at"]
    again = await client.delete(f"/api/v1/api-keys/{data['id']}", headers=session)
    assert again.status_code == 200, "revoking twice is fine — it is already revoked"


async def test_bad_scopes_are_422(client: AsyncClient) -> None:
    session = await _signup(client, "keys-bad")
    for scopes in ([], ["admin"], ["read", "root"], [" "]):
        resp = await client.post("/api/v1/api-keys", json={"name": "x", "scopes": scopes}, headers=session)
        assert resp.status_code == 422, (scopes, resp.text)
        assert resp.json()["error"]["code"] == "validation_failed"


async def test_cap_is_per_kind(client: AsyncClient) -> None:
    """10 live keys max — and MCP tokens do not eat into the key budget."""
    session = await _signup(client, "keys-cap")
    assert (await client.post("/api/v1/mcp-tokens", json={"name": "mcp"}, headers=session)).status_code == 201
    for i in range(10):
        resp = await client.post("/api/v1/api-keys", json={"name": f"k{i}", "scopes": ["read"]}, headers=session)
        assert resp.status_code == 201, resp.text
    over = await client.post("/api/v1/api-keys", json={"name": "k10", "scopes": ["read"]}, headers=session)
    assert over.status_code == 422
    # …and the MCP side still has room too (its own cap, its own count).
    assert (await client.post("/api/v1/mcp-tokens", json={"name": "mcp2"}, headers=session)).status_code == 201


async def test_keys_need_a_session(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/api-keys")).status_code == 401
    assert (await client.post("/api/v1/api-keys", json={"name": "x", "scopes": ["read"]})).status_code == 401
