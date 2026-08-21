"""Community forum, driven over HTTP.

S1.1: the migration's seeds and is_staff riding the auth payload.
S1.2: the anonymous read surface — until the write API lands in S1.3,
fixtures insert rows through the ORM.
"""

import uuid
from datetime import UTC, datetime, timedelta

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


async def _seed_forum(n_topics: int = 3, posts_in_first: int = 5) -> dict:
    """Topics in Help by a real user, the first with a chain of replies."""
    from sqlalchemy import select

    from app.core.db import async_session_factory
    from app.models.auth import User
    from app.models.community import CommunityCategory, CommunityPost, CommunityTopic
    from app.utils.slug_utils import slugify

    marker = uuid.uuid4().hex[:8]
    async with async_session_factory() as db:
        help_cat = await db.scalar(select(CommunityCategory).where(CommunityCategory.slug == "help"))
        assert help_cat is not None
        user = User(
            email=f"seed-{marker}@nodumtest.dev", password_hash="x", name=f"Seeder {marker}", email_verified=True
        )
        db.add(user)
        await db.flush()
        topics = []
        base = datetime.now(UTC)
        for i in range(n_topics):
            title = f"Seed {marker} topic {i}"
            topic = CommunityTopic(
                category_id=help_cat.id,
                author_id=user.id,
                title=title,
                slug=slugify(title),
                last_post_at=base + timedelta(minutes=i),
            )
            db.add(topic)
            await db.flush()
            db.add(CommunityPost(topic_id=topic.id, author_id=user.id, post_number=1, content=f"OP of {title}"))
            topics.append(topic)
        first = topics[0]
        for n in range(2, posts_in_first + 2):
            db.add(CommunityPost(topic_id=first.id, author_id=user.id, post_number=n, content=f"Reply {n}"))
        first.reply_count = posts_in_first
        first.last_post_number = posts_in_first + 1
        await db.commit()
        return {
            "marker": marker,
            "user_id": str(user.id),
            "topic_ids": [str(t.id) for t in topics],
        }


async def test_anonymous_reads_work_without_any_header(client: AsyncClient) -> None:
    seed = await _seed_forum()
    cats = await client.get("/api/v1/community/categories")
    assert cats.status_code == 200 and len(cats.json()["data"]) == 5

    latest = await client.get("/api/v1/community/topics", params={"limit": 100})
    assert latest.status_code == 200
    titles = [t["title"] for t in latest.json()["data"]["items"]]
    assert f"Seed {seed['marker']} topic 2" in titles

    in_help = await client.get("/api/v1/community/topics", params={"category": "help", "limit": 100})
    assert in_help.status_code == 200
    assert all(t["category_slug"] == "help" for t in in_help.json()["data"]["items"])

    topic = await client.get(f"/api/v1/community/topics/{seed['topic_ids'][0]}")
    assert topic.status_code == 200
    assert topic.json()["data"]["author"]["name"].startswith("Seeder")

    profile = await client.get(f"/api/v1/community/users/{seed['user_id']}")
    assert profile.status_code == 200
    body = profile.json()["data"]
    assert body["topic_count"] == 3 and body["post_count"] == 8


async def test_topic_list_pagination_is_honest(client: AsyncClient) -> None:
    seed = await _seed_forum(n_topics=3, posts_in_first=0)
    first = await client.get("/api/v1/community/topics", params={"category": "help", "limit": 2})
    data = first.json()["data"]
    assert data["total"] >= 3 and len(data["items"]) == 2
    past = await client.get(
        "/api/v1/community/topics", params={"category": "help", "limit": 2, "offset": data["total"] + 50}
    )
    body = past.json()["data"]
    assert body["items"] == [] and body["total"] == data["total"], "total stays honest past the end"
    assert seed["marker"]  # seed used


async def test_thread_keyset_pagination_never_repeats_or_skips(client: AsyncClient) -> None:
    seed = await _seed_forum(n_topics=1, posts_in_first=7)  # 8 posts incl. OP
    tid = seed["topic_ids"][0]
    seen: list[int] = []
    after = 0
    for _ in range(5):
        page = (await client.get(f"/api/v1/community/topics/{tid}/posts", params={"after": after, "limit": 3})).json()[
            "data"
        ]
        seen += [p["post_number"] for p in page["items"]]
        if not page["has_more"]:
            break
        after = page["items"][-1]["post_number"]
    assert seen == list(range(1, 9)), seen


async def test_deleted_posts_are_placeholders_and_deleted_topics_404(client: AsyncClient) -> None:
    from sqlalchemy import update

    from app.core.db import async_session_factory
    from app.models.community import CommunityPost, CommunityTopic

    seed = await _seed_forum(n_topics=2, posts_in_first=2)
    tid = seed["topic_ids"][0]
    async with async_session_factory() as db:
        await db.execute(
            update(CommunityPost)
            .where(CommunityPost.topic_id == tid, CommunityPost.post_number == 2)
            .values(is_deleted=True)
        )
        await db.execute(
            update(CommunityTopic).where(CommunityTopic.id == seed["topic_ids"][1]).values(is_deleted=True)
        )
        await db.commit()

    page = (await client.get(f"/api/v1/community/topics/{tid}/posts")).json()["data"]
    ghost = next(p for p in page["items"] if p["post_number"] == 2)
    assert ghost["is_deleted"] is True and "content" not in ghost
    assert [p["post_number"] for p in page["items"]] == [1, 2, 3], "numbering survives moderation"

    gone = await client.get(f"/api/v1/community/topics/{seed['topic_ids'][1]}")
    assert gone.status_code == 404
    unknown = await client.get(f"/api/v1/community/topics/{uuid.uuid4()}")
    assert unknown.status_code == 404 and unknown.json()["error"]["code"] == "not_found"


async def test_top_rejects_unknown_window(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/community/topics", params={"top": "decade"})
    assert resp.status_code == 422
