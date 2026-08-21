"""Community forum service — the read paths (S1.2).

Everything here is answerable by an anonymous visitor, so no function takes
a viewer id: viewer-dependent decoration (unread chips, own-likes) joins in
later, additively. Lists use offset+window-count pagination with an id
tie-break and an honest total past the end (the note_service pattern);
threads use keyset pagination on (topic_id, post_number) — a topic can be
thousands of posts deep and OFFSET degrades linearly.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.community import CommunityCategory, CommunityPost, CommunityTopic
from app.services.service_response import ServiceResponse
from app.utils.cache_utils import cache_delete, cache_get_json, cache_set_json

CATEGORIES_CACHE_KEY = "community:categories:v1"
_CATEGORIES_TTL_SECONDS = 60

TOP_WINDOWS: dict[str, int | None] = {"week": 7, "month": 30, "all": None}


def _author(user_id: UUID | None, name: str | None, avatar_url: str | None) -> dict[str, Any] | None:
    """A post's public byline — or None for a deleted account."""
    if user_id is None:
        return None
    return {"id": str(user_id), "name": name or "Someone", "avatar_url": avatar_url}


def _category(c: CommunityCategory) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "name": c.name,
        "slug": c.slug,
        "description": c.description,
        "position": c.position,
        "is_staff_only_posting": c.is_staff_only_posting,
        "topic_count": c.topic_count,
        "post_count": c.post_count,
    }


def _topic(t: CommunityTopic, author: dict[str, Any] | None, category_slug: str | None = None) -> dict[str, Any]:
    out = {
        "id": str(t.id),
        "category_id": str(t.category_id),
        "title": t.title,
        "slug": t.slug,
        "author": author,
        "is_pinned": t.is_pinned,
        "is_locked": t.is_locked,
        "reply_count": t.reply_count,
        "last_post_number": t.last_post_number,
        "view_count": t.view_count,
        "created_at": t.created_at.isoformat(),
        "last_post_at": t.last_post_at.isoformat(),
    }
    if category_slug is not None:
        out["category_slug"] = category_slug
    return out


async def list_categories(db: AsyncSession) -> ServiceResponse[list[dict[str, Any]]]:
    """The category rail — cached briefly: it changes only when staff post
    counts tick, and every visitor hits it."""
    cached = await cache_get_json(CATEGORIES_CACHE_KEY)
    if cached is not None:
        return ServiceResponse.ok(cached)
    rows = (await db.execute(select(CommunityCategory).order_by(CommunityCategory.position))).scalars().all()
    data = [_category(c) for c in rows]
    await cache_set_json(CATEGORIES_CACHE_KEY, data, ttl_seconds=_CATEGORIES_TTL_SECONDS)
    return ServiceResponse.ok(data)


async def invalidate_categories_cache() -> None:
    await cache_delete(CATEGORIES_CACHE_KEY)


async def get_category(db: AsyncSession, slug: str) -> ServiceResponse[CommunityCategory]:
    category = await db.scalar(select(CommunityCategory).where(CommunityCategory.slug == slug))
    if category is None:
        return ServiceResponse.fail("not_found", "Category not found.")
    return ServiceResponse.ok(category)


async def list_topics(
    db: AsyncSession,
    *,
    category_slug: str | None = None,
    top_window: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> ServiceResponse[dict[str, Any]]:
    """Topic lists: a category page (pinned first), Latest, or Top.

    Top is deliberately simple: most replies within the window — a filter
    and an order over indexed columns, not a scoring engine.
    """
    stmt = (
        select(CommunityTopic, User.name, User.avatar_url, CommunityCategory.slug, func.count().over().label("total"))
        .outerjoin(User, User.id == CommunityTopic.author_id)
        .join(CommunityCategory, CommunityCategory.id == CommunityTopic.category_id)
        .where(CommunityTopic.is_deleted.is_(False))
    )
    count_filters = [CommunityTopic.is_deleted.is_(False)]

    category: CommunityCategory | None = None
    if category_slug is not None:
        cat_res = await get_category(db, category_slug)
        if not cat_res.success:
            return cat_res  # type: ignore[return-value]
        category = cat_res.data
        assert category is not None
        stmt = stmt.where(CommunityTopic.category_id == category.id)
        count_filters.append(CommunityTopic.category_id == category.id)

    if top_window is not None:
        if top_window not in TOP_WINDOWS:
            return ServiceResponse.fail("validation_failed", 'top must be "week", "month" or "all".')
        days = TOP_WINDOWS[top_window]
        if days is not None:
            cutoff = func.now() - func.make_interval(0, 0, 0, days)
            stmt = stmt.where(CommunityTopic.last_post_at >= cutoff)
            count_filters.append(CommunityTopic.last_post_at >= cutoff)
        stmt = stmt.order_by(
            CommunityTopic.reply_count.desc(), CommunityTopic.last_post_at.desc(), CommunityTopic.id.desc()
        )
    elif category is not None:
        stmt = stmt.order_by(
            CommunityTopic.is_pinned.desc(), CommunityTopic.last_post_at.desc(), CommunityTopic.id.desc()
        )
    else:
        stmt = stmt.order_by(CommunityTopic.last_post_at.desc(), CommunityTopic.id.desc())

    rows = (await db.execute(stmt.limit(limit).offset(offset))).all()
    if rows:
        total = int(rows[0].total)
    elif offset:
        total = int(await db.scalar(select(func.count()).select_from(CommunityTopic).where(*count_filters)) or 0)
    else:
        total = 0
    items = [_topic(t, _author(t.author_id, name, avatar), slug) for t, name, avatar, slug, _ in rows]
    return ServiceResponse.ok({"items": items, "total": total, "limit": limit, "offset": offset})


async def get_topic(db: AsyncSession, topic_id: UUID) -> ServiceResponse[dict[str, Any]]:
    row = (
        await db.execute(
            select(CommunityTopic, User.name, User.avatar_url, CommunityCategory.slug)
            .outerjoin(User, User.id == CommunityTopic.author_id)
            .join(CommunityCategory, CommunityCategory.id == CommunityTopic.category_id)
            .where(CommunityTopic.id == topic_id, CommunityTopic.is_deleted.is_(False))
        )
    ).first()
    if row is None:
        return ServiceResponse.fail("not_found", "Topic not found.")
    t, name, avatar, category_slug = row
    return ServiceResponse.ok(_topic(t, _author(t.author_id, name, avatar), category_slug))


async def list_posts(
    db: AsyncSession, topic_id: UUID, *, after: int = 0, limit: int = 50
) -> ServiceResponse[dict[str, Any]]:
    """A topic's posts, keyset-paginated by post_number (`after` = the last
    number the client has). Soft-deleted posts come back as placeholders —
    the row keeps its number so the thread's shape survives moderation."""
    topic = await db.scalar(
        select(CommunityTopic.id).where(CommunityTopic.id == topic_id, CommunityTopic.is_deleted.is_(False))
    )
    if topic is None:
        return ServiceResponse.fail("not_found", "Topic not found.")
    rows = (
        await db.execute(
            select(CommunityPost, User.name, User.avatar_url)
            .outerjoin(User, User.id == CommunityPost.author_id)
            .where(CommunityPost.topic_id == topic_id, CommunityPost.post_number > after)
            .order_by(CommunityPost.post_number)
            .limit(limit + 1)  # the sentinel row answers has_more without a count
        )
    ).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = []
    for p, name, avatar in rows:
        if p.is_deleted:
            items.append({"id": str(p.id), "post_number": p.post_number, "is_deleted": True})
            continue
        items.append(
            {
                "id": str(p.id),
                "post_number": p.post_number,
                "author": _author(p.author_id, name, avatar),
                "content": p.content,
                "like_count": p.like_count,
                "edited_at": p.edited_at.isoformat() if p.edited_at else None,
                "created_at": p.created_at.isoformat(),
                "is_deleted": False,
            }
        )
    return ServiceResponse.ok({"items": items, "has_more": has_more, "limit": limit, "after": after})


async def get_profile(db: AsyncSession, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """A public profile: identity + forum stats, all from indexed counts."""
    user = await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    topic_count = await db.scalar(
        select(func.count())
        .select_from(CommunityTopic)
        .where(CommunityTopic.author_id == user_id, CommunityTopic.is_deleted.is_(False))
    )
    post_count = await db.scalar(
        select(func.count())
        .select_from(CommunityPost)
        .where(CommunityPost.author_id == user_id, CommunityPost.is_deleted.is_(False))
    )
    recent = (
        await db.execute(
            select(CommunityTopic, CommunityCategory.slug)
            .join(CommunityCategory, CommunityCategory.id == CommunityTopic.category_id)
            .where(CommunityTopic.author_id == user_id, CommunityTopic.is_deleted.is_(False))
            .order_by(CommunityTopic.created_at.desc())
            .limit(10)
        )
    ).all()
    author = _author(user.id, user.name, user.avatar_url)
    return ServiceResponse.ok(
        {
            "id": str(user.id),
            "name": user.name,
            "avatar_url": user.avatar_url,
            "is_staff": user.is_staff,
            "joined_at": user.created_at.isoformat(),
            "topic_count": int(topic_count or 0),
            "post_count": int(post_count or 0),
            "recent_topics": [_topic(t, author, slug) for t, slug in recent],
        }
    )


# ── Writes (S1.3) ────────────────────────────────────────────────────────────
#
# Every counter bump is an atomic `SET x = x ± 1` executed inside the same
# transaction as the row it counts, under the topic FOR UPDATE lock that
# post-number assignment already needs — the counters cannot drift.


async def _check_rate(
    user_id: UUID, action: str, *, limit: int, window_seconds: int, gap_seconds: int = 0
) -> str | None:
    """Fixed-window per-user throttle + minimum gap. Fail-open (Redis down →
    allowed), disabled in dev/test like the global limiter. Returns an error
    message, or None to proceed."""
    from app.settings import get_settings

    if get_settings().ENVIRONMENT in ("dev", "test"):
        return None
    try:
        from app.core.redis import redis_control

        if gap_seconds:
            gap_key = f"rl:community:gap:{action}:{user_id}"
            if not await redis_control.set(gap_key, "1", ex=gap_seconds, nx=True):
                return f"Give it {gap_seconds} seconds between {action}s."
        key = f"rl:community:{action}:{user_id}"
        count = await redis_control.incr(key)
        if count == 1:
            await redis_control.expire(key, window_seconds)
        if count > limit:
            return f"That is plenty of {action}s for now — try again in a while."
    except Exception:
        return None
    return None


def _clean_content(content: str) -> ServiceResponse[str] | str:
    from app.settings import get_settings

    content = content.strip()
    if not content:
        return ServiceResponse.fail("validation_failed", "Write something first.")
    if len(content) > get_settings().COMMUNITY_POST_MAX_CHARS:
        return ServiceResponse.fail(
            "validation_failed", f"Posts cap at {get_settings().COMMUNITY_POST_MAX_CHARS:,} characters."
        )
    return content


async def create_topic(
    db: AsyncSession, user_id: UUID, *, category_slug: str, title: str, content: str
) -> ServiceResponse[dict[str, Any]]:
    from app.utils.slug_utils import slugify

    title = title.strip()
    if not 3 <= len(title) <= 300:
        return ServiceResponse.fail("validation_failed", "Titles run 3 to 300 characters.")
    cleaned = _clean_content(content)
    if isinstance(cleaned, ServiceResponse):
        return cleaned
    cat_res = await get_category(db, category_slug)
    if not cat_res.success:
        return cat_res  # type: ignore[return-value]
    category = cat_res.data
    assert category is not None
    if category.is_staff_only_posting:
        user = await db.scalar(select(User).where(User.id == user_id))
        if user is None or not user.is_staff:
            return ServiceResponse.fail("forbidden", f"Only staff post in {category.name}.")
    if err := await _check_rate(user_id, "topic", limit=5, window_seconds=3600, gap_seconds=30):
        return ServiceResponse.fail("rate_limited", err)

    topic = CommunityTopic(
        category_id=category.id,
        author_id=user_id,
        title=title,
        slug=slugify(title),
        last_post_author_id=user_id,
    )
    db.add(topic)
    await db.flush()
    db.add(CommunityPost(topic_id=topic.id, author_id=user_id, post_number=1, content=cleaned))
    await db.execute(
        CommunityCategory.__table__.update()
        .where(CommunityCategory.id == category.id)
        .values(topic_count=CommunityCategory.topic_count + 1, post_count=CommunityCategory.post_count + 1)
    )
    await db.commit()
    await invalidate_categories_cache()
    return await get_topic(db, topic.id)


async def create_post(
    db: AsyncSession, user_id: UUID, topic_id: UUID, *, content: str
) -> ServiceResponse[dict[str, Any]]:
    cleaned = _clean_content(content)
    if isinstance(cleaned, ServiceResponse):
        return cleaned
    if err := await _check_rate(user_id, "post", limit=30, window_seconds=3600, gap_seconds=10):
        return ServiceResponse.fail("rate_limited", err)

    # The lock serialises number assignment AND every counter this touches.
    topic = await db.scalar(
        select(CommunityTopic)
        .where(CommunityTopic.id == topic_id, CommunityTopic.is_deleted.is_(False))
        .with_for_update()
    )
    if topic is None:
        return ServiceResponse.fail("not_found", "Topic not found.")
    if topic.is_locked:
        return ServiceResponse.fail("conflict", "This topic is locked.")

    number = topic.last_post_number + 1
    post = CommunityPost(topic_id=topic.id, author_id=user_id, post_number=number, content=cleaned)
    db.add(post)
    topic.last_post_number = number
    topic.reply_count = topic.reply_count + 1
    topic.last_post_at = func.now()
    topic.last_post_author_id = user_id
    await db.execute(
        CommunityCategory.__table__.update()
        .where(CommunityCategory.id == topic.category_id)
        .values(post_count=CommunityCategory.post_count + 1)
    )
    await db.commit()
    await db.refresh(post)
    return ServiceResponse.ok(
        {
            "id": str(post.id),
            "topic_id": str(topic.id),
            "post_number": post.post_number,
            "content": post.content,
            "created_at": post.created_at.isoformat(),
        }
    )


async def edit_post(db: AsyncSession, user_id: UUID, post_id: UUID, *, content: str) -> ServiceResponse[dict[str, Any]]:
    """Authors edit their own posts; staff editing is deliberately absent —
    staff delete, they do not rewrite other people's words."""
    cleaned = _clean_content(content)
    if isinstance(cleaned, ServiceResponse):
        return cleaned
    post = await db.scalar(
        select(CommunityPost).where(CommunityPost.id == post_id, CommunityPost.is_deleted.is_(False))
    )
    if post is None:
        return ServiceResponse.fail("not_found", "Post not found.")
    if post.author_id != user_id:
        return ServiceResponse.fail("forbidden", "Only the author edits a post.")
    topic_locked = await db.scalar(select(CommunityTopic.is_locked).where(CommunityTopic.id == post.topic_id))
    if topic_locked:
        return ServiceResponse.fail("conflict", "This topic is locked.")
    post.content = cleaned
    post.edited_at = func.now()
    await db.commit()
    await db.refresh(post)
    return ServiceResponse.ok(
        {
            "id": str(post.id),
            "post_number": post.post_number,
            "content": post.content,
            "edited_at": post.edited_at.isoformat() if post.edited_at else None,
        }
    )


async def delete_post(
    db: AsyncSession, user_id: UUID, post_id: UUID, *, as_staff: bool = False
) -> ServiceResponse[dict[str, Any]]:
    """Soft delete. The OP (post 1) cannot go alone — delete the topic.

    Takes the topic lock first: the reply-count decrement must not race a
    concurrent reply's increment."""
    post = await db.scalar(
        select(CommunityPost).where(CommunityPost.id == post_id, CommunityPost.is_deleted.is_(False))
    )
    if post is None:
        return ServiceResponse.fail("not_found", "Post not found.")
    if not as_staff and post.author_id != user_id:
        return ServiceResponse.fail("forbidden", "Only the author (or staff) deletes a post.")
    if post.post_number == 1:
        return ServiceResponse.fail("validation_failed", "The opening post is the topic — delete the topic instead.")
    topic = await db.scalar(select(CommunityTopic).where(CommunityTopic.id == post.topic_id).with_for_update())
    assert topic is not None
    post.is_deleted = True
    topic.reply_count = topic.reply_count - 1  # last_post_number NEVER decrements
    await db.execute(
        CommunityCategory.__table__.update()
        .where(CommunityCategory.id == topic.category_id)
        .values(post_count=CommunityCategory.post_count - 1)
    )
    await db.commit()
    return ServiceResponse.ok({"deleted": str(post_id)})


async def delete_topic(
    db: AsyncSession, user_id: UUID, topic_id: UUID, *, as_staff: bool = False
) -> ServiceResponse[dict[str, Any]]:
    """Soft delete a whole topic. Authors may while it has no replies —
    after someone answered, the thread belongs to the conversation (staff only)."""
    topic = await db.scalar(
        select(CommunityTopic)
        .where(CommunityTopic.id == topic_id, CommunityTopic.is_deleted.is_(False))
        .with_for_update()
    )
    if topic is None:
        return ServiceResponse.fail("not_found", "Topic not found.")
    if not as_staff:
        if topic.author_id != user_id:
            return ServiceResponse.fail("forbidden", "Only the author (or staff) deletes a topic.")
        if topic.reply_count > 0:
            return ServiceResponse.fail("conflict", "People have replied — the thread is theirs too now. Ask staff.")
    live_posts = await db.scalar(
        select(func.count())
        .select_from(CommunityPost)
        .where(CommunityPost.topic_id == topic.id, CommunityPost.is_deleted.is_(False))
    )
    topic.is_deleted = True
    await db.execute(
        CommunityCategory.__table__.update()
        .where(CommunityCategory.id == topic.category_id)
        .values(
            topic_count=CommunityCategory.topic_count - 1,
            post_count=CommunityCategory.post_count - int(live_posts or 0),
        )
    )
    await db.commit()
    await invalidate_categories_cache()
    return ServiceResponse.ok({"deleted": str(topic_id)})
