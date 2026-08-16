"""Bring-your-own-key AI credentials.

The property that matters: a user's provider key goes in and never comes back
out — not through the AI endpoints, not through the auth endpoints that
serialize `users.settings`, and not to another user. And what lands in the
database is ciphertext.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import async_session_factory
from app.models.ai import AICredential

SECRET_KEY_VALUE = "sk-ant-test-DO-NOT-ECHO-4f2b9c"


async def _signup(client: AsyncClient, prefix: str) -> dict:
    creds = {
        "email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "AI Tester",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return resp.json()["data"]


@pytest.fixture
async def account(client: AsyncClient) -> dict:
    return await _signup(client, "ai")


def _auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_status_is_unconfigured_before_anything_is_saved(
    client: AsyncClient, account: dict
) -> None:
    resp = await client.get("/api/v1/ai/status", headers=_auth(account))
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["configured"] is False
    assert data["active_provider"] is None
    # The UI needs the provider catalogue even before anything is set up.
    assert {p["id"] for p in data["providers"]} == {"anthropic", "openai", "gemini", "qwen"}


async def test_the_key_is_stored_encrypted_and_never_returned(
    client: AsyncClient, account: dict
) -> None:
    headers = _auth(account)
    saved = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "anthropic", "api_key": SECRET_KEY_VALUE, "model": "claude-sonnet-4-5"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert SECRET_KEY_VALUE not in saved.text

    status = await client.get("/api/v1/ai/status", headers=headers)
    body = status.json()["data"]
    assert body["configured"] is True
    assert body["active_provider"] == "anthropic"
    assert body["active_model"] == "claude-sonnet-4-5"
    assert SECRET_KEY_VALUE not in status.text
    # A hint, not the key: enough to recognise which key is stored.
    assert body["credentials"][0]["key_hint"] == "sk-ant…2b9c"

    # The auth endpoints serialize users.settings in full — the key must not be
    # anywhere in there either.
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert SECRET_KEY_VALUE not in me.text
    assert me.json()["data"]["settings"].get("aiProvider") == "anthropic"

    # And the column itself is ciphertext.
    async with async_session_factory() as session:
        row = (
            await session.execute(
                select(AICredential).where(AICredential.provider == "anthropic")
            )
        ).scalars().all()
        stored = [c for c in row if c.key_hint.endswith(SECRET_KEY_VALUE[-4:])]
        assert stored, "credential row not found"
        assert SECRET_KEY_VALUE not in stored[0].key_ciphertext
        assert stored[0].key_ciphertext.startswith("v1:")


async def test_another_user_cannot_see_or_delete_it(client: AsyncClient, account: dict) -> None:
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "model": "gpt-4.1"},
        headers=_auth(account),
    )
    other = await _signup(client, "ai-other")
    status = await client.get("/api/v1/ai/status", headers=_auth(other))
    assert status.json()["data"]["configured"] is False
    assert SECRET_KEY_VALUE not in status.text

    removed = await client.delete("/api/v1/ai/credentials/openai", headers=_auth(other))
    assert removed.status_code == 404

    # The owner still has it.
    mine = await client.get("/api/v1/ai/status", headers=_auth(account))
    assert mine.json()["data"]["configured"] is True


async def test_model_can_be_changed_without_re_pasting_the_key(
    client: AsyncClient, account: dict
) -> None:
    headers = _auth(account)
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "api_key": SECRET_KEY_VALUE, "model": "gpt-4.1"},
        headers=headers,
    )
    changed = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "model": "gpt-4.1-mini"},
        headers=headers,
    )
    assert changed.status_code == 200, changed.text
    status = (await client.get("/api/v1/ai/status", headers=headers)).json()["data"]
    assert status["active_model"] == "gpt-4.1-mini"
    assert status["credentials"][0]["key_hint"].endswith(SECRET_KEY_VALUE[-4:])


async def test_deleting_clears_the_active_provider(client: AsyncClient, account: dict) -> None:
    headers = _auth(account)
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "gemini", "api_key": SECRET_KEY_VALUE, "model": "gemini-2.5-flash"},
        headers=headers,
    )
    assert (await client.delete("/api/v1/ai/credentials/gemini", headers=headers)).status_code == 200
    status = (await client.get("/api/v1/ai/status", headers=headers)).json()["data"]
    assert status["configured"] is False
    assert status["active_provider"] is None


async def test_unknown_provider_is_refused(client: AsyncClient, account: dict) -> None:
    resp = await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "totally-made-up", "api_key": "x", "model": "y"},
        headers=_auth(account),
    )
    assert resp.status_code == 422


async def test_chat_without_a_key_says_so(client: AsyncClient, account: dict) -> None:
    resp = await client.post(
        "/api/v1/ai/chat",
        json={"messages": [{"role": "user", "content": "hello"}]},
        headers=_auth(account),
    )
    assert resp.status_code == 404
    assert "configured" in resp.json()["error"]["message"].lower()


async def test_ai_endpoints_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/ai/status")).status_code == 401
    assert (
        await client.put("/api/v1/ai/credentials", json={"provider": "openai", "api_key": "x"})
    ).status_code == 401
