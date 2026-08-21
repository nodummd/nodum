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


# ── S1.3: the write API ──────────────────────────────────────────────────────


async def _post_topic(client: AsyncClient, headers: dict, title: str, category: str = "help") -> dict:
    resp = await client.post(
        "/api/v1/community/topics",
        json={"category": category, "title": title, "content": f"OP for {title}"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


async def test_topic_and_reply_lifecycle(client: AsyncClient) -> None:
    author = await _signup(client, "author")
    marker = uuid.uuid4().hex[:8]
    topic = await _post_topic(client, author, f"Lifecycle {marker}")
    assert topic["reply_count"] == 0 and topic["last_post_number"] == 1

    anonymous_denied = await client.post(f"/api/v1/community/topics/{topic['id']}/posts", json={"content": "hi"})
    assert anonymous_denied.status_code == 401

    reply = await client.post(
        f"/api/v1/community/topics/{topic['id']}/posts", json={"content": "First answer."}, headers=author
    )
    assert reply.status_code == 201 and reply.json()["data"]["post_number"] == 2

    refreshed = (await client.get(f"/api/v1/community/topics/{topic['id']}")).json()["data"]
    assert refreshed["reply_count"] == 1 and refreshed["last_post_number"] == 2

    edited = await client.patch(
        f"/api/v1/community/posts/{reply.json()['data']['id']}", json={"content": "Better answer."}, headers=author
    )
    assert edited.status_code == 200 and edited.json()["data"]["edited_at"] is not None

    gone = await client.delete(f"/api/v1/community/posts/{reply.json()['data']['id']}", headers=author)
    assert gone.status_code == 200
    after = (await client.get(f"/api/v1/community/topics/{topic['id']}")).json()["data"]
    assert after["reply_count"] == 0
    assert after["last_post_number"] == 2, "numbers never come back"

    # Replyless again → the author may delete the whole topic.
    assert (await client.delete(f"/api/v1/community/topics/{topic['id']}", headers=author)).status_code == 200
    assert (await client.get(f"/api/v1/community/topics/{topic['id']}")).status_code == 404


async def test_only_the_author_touches_a_post(client: AsyncClient) -> None:
    author = await _signup(client, "owner")
    stranger = await _signup(client, "stranger")
    topic = await _post_topic(client, author, f"Ownership {uuid.uuid4().hex[:8]}")
    reply = (
        await client.post(f"/api/v1/community/topics/{topic['id']}/posts", json={"content": "mine"}, headers=author)
    ).json()["data"]

    for attempt in (
        client.patch(f"/api/v1/community/posts/{reply['id']}", json={"content": "defaced"}, headers=stranger),
        client.delete(f"/api/v1/community/posts/{reply['id']}", headers=stranger),
        client.delete(f"/api/v1/community/topics/{topic['id']}", headers=stranger),
    ):
        resp = await attempt
        assert resp.status_code == 403, resp.text

    # After a reply exists, even the author cannot delete the topic.
    assert (await client.delete(f"/api/v1/community/topics/{topic['id']}", headers=author)).status_code == 409


async def test_locked_and_staff_only_and_caps(client: AsyncClient) -> None:
    from sqlalchemy import update

    from app.core.db import async_session_factory
    from app.models.community import CommunityTopic

    user = await _signup(client, "rules")
    topic = await _post_topic(client, user, f"Rules {uuid.uuid4().hex[:8]}")

    async with async_session_factory() as db:
        await db.execute(update(CommunityTopic).where(CommunityTopic.id == topic["id"]).values(is_locked=True))
        await db.commit()
    locked = await client.post(
        f"/api/v1/community/topics/{topic['id']}/posts", json={"content": "too late"}, headers=user
    )
    assert locked.status_code == 409 and "locked" in locked.json()["error"]["message"]

    staff_only = await client.post(
        "/api/v1/community/topics",
        json={"category": "announcements", "title": "Not staff", "content": "hi"},
        headers=user,
    )
    assert staff_only.status_code == 403

    from app.settings import get_settings

    over_cap = await client.post(
        "/api/v1/community/topics",
        json={"category": "help", "title": "Big", "content": "x" * (get_settings().COMMUNITY_POST_MAX_CHARS + 1)},
        headers=user,
    )
    assert over_cap.status_code == 422

    tiny_title = await client.post(
        "/api/v1/community/topics", json={"category": "help", "title": "ab", "content": "hi"}, headers=user
    )
    assert tiny_title.status_code == 422

    ghost_category = await client.post(
        "/api/v1/community/topics", json={"category": "nope", "title": "Where", "content": "hi"}, headers=user
    )
    assert ghost_category.status_code == 404


async def test_concurrent_replies_get_distinct_numbers(client: AsyncClient) -> None:
    import asyncio

    user = await _signup(client, "race")
    topic = await _post_topic(client, user, f"Race {uuid.uuid4().hex[:8]}")

    async def reply(i: int):
        return await client.post(
            f"/api/v1/community/topics/{topic['id']}/posts", json={"content": f"racer {i}"}, headers=user
        )

    results = await asyncio.gather(*[reply(i) for i in range(6)])
    assert all(r.status_code == 201 for r in results)
    numbers = sorted(r.json()["data"]["post_number"] for r in results)
    assert numbers == [2, 3, 4, 5, 6, 7], numbers
    refreshed = (await client.get(f"/api/v1/community/topics/{topic['id']}")).json()["data"]
    assert refreshed["reply_count"] == 6 and refreshed["last_post_number"] == 7


async def test_category_counters_track_the_truth(client: AsyncClient) -> None:
    user = await _signup(client, "count")
    before = next(
        c for c in (await client.get("/api/v1/community/categories")).json()["data"] if c["slug"] == "showcase"
    )
    topic = await _post_topic(client, user, f"Counters {uuid.uuid4().hex[:8]}", category="showcase")
    await client.post(f"/api/v1/community/topics/{topic['id']}/posts", json={"content": "r"}, headers=user)
    mid = next(c for c in (await client.get("/api/v1/community/categories")).json()["data"] if c["slug"] == "showcase")
    assert mid["topic_count"] == before["topic_count"] + 1
    assert mid["post_count"] == before["post_count"] + 2

    # delete the reply, then the topic (as its author, after clearing the reply)
    posts = (await client.get(f"/api/v1/community/topics/{topic['id']}/posts")).json()["data"]["items"]
    reply_id = next(p["id"] for p in posts if p["post_number"] == 2)
    assert (await client.delete(f"/api/v1/community/posts/{reply_id}", headers=user)).status_code == 200
    assert (await client.delete(f"/api/v1/community/topics/{topic['id']}", headers=user)).status_code == 200
    after = next(
        c for c in (await client.get("/api/v1/community/categories")).json()["data"] if c["slug"] == "showcase"
    )
    assert after["topic_count"] == before["topic_count"]
    assert after["post_count"] == before["post_count"]


# ── S1.4: likes & read tracking ──────────────────────────────────────────────


async def test_likes_are_idempotent_and_counted(client: AsyncClient) -> None:
    author = await _signup(client, "liked")
    fan = await _signup(client, "fan")
    topic = await _post_topic(client, author, f"Likes {uuid.uuid4().hex[:8]}")
    post_id = (await client.get(f"/api/v1/community/topics/{topic['id']}/posts")).json()["data"]["items"][0]["id"]

    for _ in range(3):  # hammering like stays at 1
        liked = await client.put(f"/api/v1/community/posts/{post_id}/like", headers=fan)
        assert liked.status_code == 200 and liked.json()["data"]["like_count"] == 1

    also = await client.put(f"/api/v1/community/posts/{post_id}/like", headers=author)
    assert also.json()["data"]["like_count"] == 2

    page = (await client.get(f"/api/v1/community/topics/{topic['id']}/posts", headers=fan)).json()["data"]
    assert page["items"][0]["liked_by_viewer"] is True and page["items"][0]["like_count"] == 2
    anon = (await client.get(f"/api/v1/community/topics/{topic['id']}/posts")).json()["data"]
    assert "liked_by_viewer" not in anon["items"][0], "anonymous payloads stay undecorated"

    for _ in range(2):  # unlike is idempotent too
        unliked = await client.delete(f"/api/v1/community/posts/{post_id}/like", headers=fan)
        assert unliked.status_code == 200 and unliked.json()["data"]["like_count"] == 1

    assert (await client.put(f"/api/v1/community/posts/{post_id}/like")).status_code == 401


async def test_unread_tracking_moves_only_forward(client: AsyncClient) -> None:
    alice = await _signup(client, "alice")
    bob = await _signup(client, "bob")
    topic = await _post_topic(client, bob, f"Unread {uuid.uuid4().hex[:8]}")

    def flag(listing: dict, tid: str) -> bool:
        return next(t["unread"] for t in listing["items"] if t["id"] == tid)

    listing = (await client.get("/api/v1/community/topics", params={"limit": 100}, headers=alice)).json()["data"]
    assert flag(listing, topic["id"]) is True, "never opened → unread"
    anon = (await client.get("/api/v1/community/topics", params={"limit": 100})).json()["data"]
    assert all("unread" not in t for t in anon["items"])

    read = await client.put(f"/api/v1/community/topics/{topic['id']}/read", json={"post_number": 1}, headers=alice)
    assert read.status_code == 200
    listing = (await client.get("/api/v1/community/topics", params={"limit": 100}, headers=alice)).json()["data"]
    assert flag(listing, topic["id"]) is False

    # Bob replies → unread again for Alice.
    await client.post(f"/api/v1/community/topics/{topic['id']}/posts", json={"content": "news"}, headers=bob)
    listing = (await client.get("/api/v1/community/topics", params={"limit": 100}, headers=alice)).json()["data"]
    assert flag(listing, topic["id"]) is True

    # Alice catches up; a stale out-of-order beacon cannot drag her back.
    await client.put(f"/api/v1/community/topics/{topic['id']}/read", json={"post_number": 2}, headers=alice)
    await client.put(f"/api/v1/community/topics/{topic['id']}/read", json={"post_number": 1}, headers=alice)
    listing = (await client.get("/api/v1/community/topics", params={"limit": 100}, headers=alice)).json()["data"]
    assert flag(listing, topic["id"]) is False, "the pointer never moves backward"

    # A beacon past the end clamps to the real last post.
    clamped = await client.put(f"/api/v1/community/topics/{topic['id']}/read", json={"post_number": 999}, headers=alice)
    assert clamped.json()["data"]["last_read_post_number"] == 2
