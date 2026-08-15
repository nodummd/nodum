"""Auth flow integration tests — require the dev/test infra (postgres) up.

Run: uv run pytest tests/integration -q   (after ./deploy/compose.sh dev up -d)
Each test uses a unique email so runs never collide.
"""

import uuid
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select


def _creds() -> dict[str, str]:
    return {
        "email": f"test-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "Test User",
    }


async def _signup(client: AsyncClient) -> tuple[dict, dict]:
    creds = _creds()
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    # Clear the cookie jar so tests exercise body-token flows explicitly;
    # the refresh endpoint prefers the httpOnly cookie when present.
    client.cookies.clear()
    return creds, resp.json()["data"]


async def test_signup_returns_tokens_and_user(client: AsyncClient) -> None:
    creds, data = await _signup(client)
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["user"]["email"] == creds["email"]
    assert data["user"]["name"] == creds["name"]


async def test_signup_duplicate_email_conflicts(client: AsyncClient) -> None:
    creds, _ = await _signup(client)
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "already_exists"


async def test_login_wrong_password_rejected(client: AsyncClient) -> None:
    creds, _ = await _signup(client)
    resp = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": "wrong-password"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


async def test_login_and_me_roundtrip(client: AsyncClient) -> None:
    creds, _ = await _signup(client)
    resp = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert resp.status_code == 200
    token = resp.json()["data"]["access_token"]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["data"]["email"] == creds["email"]


async def test_me_without_token_unauthorized(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_refresh_rotates_with_grace_then_blocks_reuse(client: AsyncClient) -> None:
    _, data = await _signup(client)
    old_refresh = data["refresh_token"]

    # Rotate: old refresh yields a new pair (body-based, no cookie jar here)
    r1 = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200, r1.text
    client.cookies.clear()
    new_pair = r1.json()["data"]
    assert new_pair["refresh_token"] != old_refresh

    # New access token works
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_pair['access_token']}"})
    assert me.status_code == 200

    # Immediate reuse of the just-spent token is a benign duplicate (grace
    # window) and CONVERGES: the racer receives the session's current JTI so
    # response ordering can never strand a tab with a doomed token.
    r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 200, r2.text
    client.cookies.clear()
    graced_pair = r2.json()["data"]
    assert graced_pair["refresh_token"] == new_pair["refresh_token"]

    # Simulate grace expiry, then reuse of a long-spent token must trip the
    # stolen-token defense and kill the whole session family.
    from app.core.redis import redis_control

    async for key in redis_control.scan_iter("refresh_grace:*"):
        await redis_control.delete(key)

    r3 = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r3.status_code == 401

    # The current token was invalidated by the family nuke too
    r4 = await client.post("/api/v1/auth/refresh", json={"refresh_token": new_pair["refresh_token"]})
    assert r4.status_code == 401


async def test_concurrent_refresh_does_not_kill_the_session(client: AsyncClient) -> None:
    """Two refreshes in flight at once must both succeed.

    This is the ordinary case of a tab reloading while something else (a save,
    a websocket reconnect) refreshes too. If the grace marker is published only
    AFTER the rotation commits, the loser sees a JTI that exists in neither the
    table nor the grace key, calls it a stolen token, and invalidates every
    session the user has — a spurious logout.
    """
    import asyncio

    _, data = await _signup(client)
    token = data["refresh_token"]

    first, second = await asyncio.gather(
        client.post("/api/v1/auth/refresh", json={"refresh_token": token}),
        client.post("/api/v1/auth/refresh", json={"refresh_token": token}),
    )
    client.cookies.clear()
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    # Both racers converge on the same live token — neither is left holding one
    # that dies when the grace window closes.
    assert first.json()["data"]["refresh_token"] == second.json()["data"]["refresh_token"]

    # And the session still works afterwards.
    survivor = first.json()["data"]["refresh_token"]
    again = await client.post("/api/v1/auth/refresh", json={"refresh_token": survivor})
    assert again.status_code == 200, again.text


async def test_grace_marker_is_published_before_the_rotation_commits(client: AsyncClient) -> None:
    """The window that makes concurrent refresh dangerous must not exist.

    Racing the two requests is timing-dependent, so assert the invariant that
    removes the race instead: at the moment the grace key is written, the new
    JTI must NOT yet be committed. Any other order leaves an interval in which
    the old JTI resolves nowhere and a racer trips the stolen-token defense.
    """
    from app.core import redis as redis_module
    from app.core.db import async_session_factory
    from app.models.auth import Session
    from app.utils.jwt_utils import decode_token

    _, data = await _signup(client)
    old_jti = str(decode_token(data["refresh_token"], expected_type="refresh")["jti"])

    original_set = redis_module.redis_control.set
    observed: dict[str, str | None] = {}

    async def spy(key: str, value: str, **kwargs: object):
        if key.startswith("refresh_grace:"):
            # A separate connection: MVCC shows the pre-commit value, so this
            # reads the JTI as it stands on disk right now.
            async with async_session_factory() as probe:
                observed["committed_jti"] = await probe.scalar(
                    select(Session.refresh_token_jti).where(Session.id == UUID(value))
                )
        return await original_set(key, value, **kwargs)

    redis_module.redis_control.set = spy  # type: ignore[method-assign]
    try:
        resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]})
    finally:
        redis_module.redis_control.set = original_set  # type: ignore[method-assign]

    assert resp.status_code == 200, resp.text
    assert observed.get("committed_jti") == old_jti, (
        "grace key was written after the rotation committed — concurrent refresh can log the user out"
    )


async def test_logout_invalidates_session(client: AsyncClient) -> None:
    _, data = await _signup(client)
    resp = await client.post("/api/v1/auth/logout", json={"refresh_token": data["refresh_token"]})
    assert resp.status_code == 200

    reused = await client.post("/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert reused.status_code == 401


async def test_update_profile_and_change_password(client: AsyncClient) -> None:
    creds, data = await _signup(client)
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    patched = await client.patch(
        "/api/v1/auth/me", json={"name": "Renamed", "settings": {"theme": "dark"}}, headers=headers
    )
    assert patched.status_code == 200
    assert patched.json()["data"]["name"] == "Renamed"
    assert patched.json()["data"]["settings"]["theme"] == "dark"

    changed = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": creds["password"], "new_password": "new-Password-123"},
        headers=headers,
    )
    assert changed.status_code == 200

    relogin = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": "new-Password-123"})
    assert relogin.status_code == 200
