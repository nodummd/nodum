"""Community forum, driven over HTTP. Started in S1.1 with the foundations:
the migration's seeds, and is_staff riding the auth payload."""

import uuid

from httpx import AsyncClient


async def _signup(client: AsyncClient, prefix: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={"email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev", "password": "s3cure-Password!", "name": "C"},
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}


async def test_categories_are_seeded_exactly_once(client: AsyncClient) -> None:
    from sqlalchemy import select

    from app.core.db import async_session_factory
    from app.models.community import CommunityCategory

    async with async_session_factory() as db:
        rows = (await db.execute(select(CommunityCategory).order_by(CommunityCategory.position))).scalars().all()
    slugs = [c.slug for c in rows]
    assert slugs == ["announcements", "help", "bugs", "features", "showcase"]
    announcements = rows[0]
    assert announcements.is_staff_only_posting is True
    assert all(not c.is_staff_only_posting for c in rows[1:])


async def test_auth_me_carries_is_staff(client: AsyncClient) -> None:
    session = await _signup(client, "staffflag")
    me = await client.get("/api/v1/auth/me", headers=session)
    assert me.status_code == 200, me.text
    assert me.json()["data"]["is_staff"] is False
