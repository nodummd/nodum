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

from sqlalchemy import func, literal, select
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


# ── Likes & read tracking (S1.4) ─────────────────────────────────────────────


async def like_post(db: AsyncSession, user_id: UUID, post_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """Idempotent: the ON CONFLICT no-op means the counter bumps only when a
    row was actually inserted — a double-click cannot double-count."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models.community import CommunityPostLike

    post = await db.scalar(
        select(CommunityPost).where(CommunityPost.id == post_id, CommunityPost.is_deleted.is_(False))
    )
    if post is None:
        return ServiceResponse.fail("not_found", "Post not found.")
    result = await db.execute(
        pg_insert(CommunityPostLike.__table__)
        .values(post_id=post_id, user_id=user_id)
        .on_conflict_do_nothing(index_elements=["post_id", "user_id"])
    )
    if result.rowcount == 1:
        await db.execute(
            CommunityPost.__table__.update()
            .where(CommunityPost.id == post_id)
            .values(like_count=CommunityPost.like_count + 1)
        )
    await db.commit()
    count = await db.scalar(select(CommunityPost.like_count).where(CommunityPost.id == post_id))
    return ServiceResponse.ok({"post_id": str(post_id), "liked": True, "like_count": int(count or 0)})


async def unlike_post(db: AsyncSession, user_id: UUID, post_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """Unliking something never liked is a clean no-op, not an error."""
    from sqlalchemy import delete as sa_delete

    from app.models.community import CommunityPostLike

    post = await db.scalar(select(CommunityPost.id).where(CommunityPost.id == post_id))
    if post is None:
        return ServiceResponse.fail("not_found", "Post not found.")
    result = await db.execute(
        sa_delete(CommunityPostLike.__table__).where(
            CommunityPostLike.post_id == post_id, CommunityPostLike.user_id == user_id
        )
    )
    if result.rowcount == 1:
        await db.execute(
            CommunityPost.__table__.update()
            .where(CommunityPost.id == post_id)
            .values(like_count=CommunityPost.like_count - 1)
        )
    await db.commit()
    count = await db.scalar(select(CommunityPost.like_count).where(CommunityPost.id == post_id))
    return ServiceResponse.ok({"post_id": str(post_id), "liked": False, "like_count": int(count or 0)})


async def liked_post_ids(db: AsyncSession, user_id: UUID, post_ids: list[UUID]) -> set[str]:
    """Which of these posts the viewer liked — one IN query for a whole page."""
    from app.models.community import CommunityPostLike

    if not post_ids:
        return set()
    rows = await db.execute(
        select(CommunityPostLike.post_id).where(
            CommunityPostLike.user_id == user_id, CommunityPostLike.post_id.in_(post_ids)
        )
    )
    return {str(r) for r in rows.scalars()}


async def mark_read(
    db: AsyncSession, user_id: UUID, topic_id: UUID, *, post_number: int
) -> ServiceResponse[dict[str, Any]]:
    """GREATEST on conflict: an out-of-order beacon can never move the
    pointer backward and resurrect an unread badge."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models.community import CommunityTopicRead

    topic = await db.scalar(
        select(CommunityTopic.last_post_number).where(
            CommunityTopic.id == topic_id, CommunityTopic.is_deleted.is_(False)
        )
    )
    if topic is None:
        return ServiceResponse.fail("not_found", "Topic not found.")
    clamped = max(1, min(post_number, int(topic)))
    stmt = pg_insert(CommunityTopicRead.__table__).values(
        user_id=user_id, topic_id=topic_id, last_read_post_number=clamped
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "topic_id"],
        set_={
            "last_read_post_number": func.greatest(
                CommunityTopicRead.last_read_post_number, stmt.excluded.last_read_post_number
            ),
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()
    return ServiceResponse.ok({"topic_id": str(topic_id), "last_read_post_number": clamped})


async def unread_map(db: AsyncSession, user_id: UUID, topic_ids: list[UUID]) -> dict[str, bool]:
    """topic id → has-unread, for decorating a list page in one query.
    A topic never opened counts as unread."""
    from app.models.community import CommunityTopicRead

    if not topic_ids:
        return {}
    rows = (
        await db.execute(
            select(
                CommunityTopic.id,
                CommunityTopic.last_post_number,
                CommunityTopicRead.last_read_post_number,
            )
            .outerjoin(
                CommunityTopicRead,
                (CommunityTopicRead.topic_id == CommunityTopic.id) & (CommunityTopicRead.user_id == user_id),
            )
            .where(CommunityTopic.id.in_(topic_ids))
        )
    ).all()
    return {str(tid): (read is None or last > read) for tid, last, read in rows}


# ── Moderation (S1.5) ────────────────────────────────────────────────────────


async def require_staff(db: AsyncSession, user_id: UUID) -> ServiceResponse[User]:
    user = await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if user is None or not user.is_staff:
        return ServiceResponse.fail("forbidden", "Staff only.")
    return ServiceResponse.ok(user)


async def moderate_topic(
    db: AsyncSession,
    staff_id: UUID,
    topic_id: UUID,
    *,
    pinned: bool | None = None,
    locked: bool | None = None,
    title: str | None = None,
    category_slug: str | None = None,
) -> ServiceResponse[dict[str, Any]]:
    """Pin, lock, retitle, recategorize — any subset in one call. Moving
    category migrates its share of both categories' counters."""
    from app.utils.slug_utils import slugify

    staff = await require_staff(db, staff_id)
    if not staff.success:
        return staff  # type: ignore[return-value]
    topic = await db.scalar(
        select(CommunityTopic)
        .where(CommunityTopic.id == topic_id, CommunityTopic.is_deleted.is_(False))
        .with_for_update()
    )
    if topic is None:
        return ServiceResponse.fail("not_found", "Topic not found.")

    if pinned is not None:
        topic.is_pinned = pinned
    if locked is not None:
        topic.is_locked = locked
    if title is not None:
        title = title.strip()
        if not 3 <= len(title) <= 300:
            return ServiceResponse.fail("validation_failed", "Titles run 3 to 300 characters.")
        topic.title = title
        topic.slug = slugify(title)
    if category_slug is not None:
        cat_res = await get_category(db, category_slug)
        if not cat_res.success:
            return cat_res  # type: ignore[return-value]
        new_cat = cat_res.data
        assert new_cat is not None
        if new_cat.id != topic.category_id:
            live_posts = await db.scalar(
                select(func.count())
                .select_from(CommunityPost)
                .where(CommunityPost.topic_id == topic.id, CommunityPost.is_deleted.is_(False))
            )
            await db.execute(
                CommunityCategory.__table__.update()
                .where(CommunityCategory.id == topic.category_id)
                .values(
                    topic_count=CommunityCategory.topic_count - 1,
                    post_count=CommunityCategory.post_count - int(live_posts or 0),
                )
            )
            await db.execute(
                CommunityCategory.__table__.update()
                .where(CommunityCategory.id == new_cat.id)
                .values(
                    topic_count=CommunityCategory.topic_count + 1,
                    post_count=CommunityCategory.post_count + int(live_posts or 0),
                )
            )
            topic.category_id = new_cat.id
            await invalidate_categories_cache()
    await db.commit()
    return await get_topic(db, topic_id)


async def report_post(
    db: AsyncSession, user_id: UUID, post_id: UUID, *, reason: str, detail: str = ""
) -> ServiceResponse[dict[str, Any]]:
    from sqlalchemy.exc import IntegrityError

    from app.models.community import CommunityReport

    post = await db.scalar(
        select(CommunityPost.id).where(CommunityPost.id == post_id, CommunityPost.is_deleted.is_(False))
    )
    if post is None:
        return ServiceResponse.fail("not_found", "Post not found.")
    reason = reason.strip()[:50]
    if not reason:
        return ServiceResponse.fail("validation_failed", "Say why you are reporting it.")
    report = CommunityReport(post_id=post_id, reporter_id=user_id, reason=reason, detail=detail.strip() or None)
    db.add(report)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return ServiceResponse.fail("already_exists", "You already reported this post.")
    return ServiceResponse.ok({"id": str(report.id), "post_id": str(post_id), "status": "open"})


async def list_reports(
    db: AsyncSession, staff_id: UUID, *, status: str = "open", limit: int = 50, offset: int = 0
) -> ServiceResponse[dict[str, Any]]:
    from app.models.community import CommunityReport

    staff = await require_staff(db, staff_id)
    if not staff.success:
        return staff  # type: ignore[return-value]
    if status not in ("open", "resolved"):
        return ServiceResponse.fail("validation_failed", 'status is "open" or "resolved".')
    rows = (
        await db.execute(
            select(CommunityReport, CommunityPost, CommunityTopic.title, User.name, func.count().over().label("total"))
            .join(CommunityPost, CommunityPost.id == CommunityReport.post_id)
            .join(CommunityTopic, CommunityTopic.id == CommunityPost.topic_id)
            .outerjoin(User, User.id == CommunityReport.reporter_id)
            .where(CommunityReport.status == status)
            .order_by(CommunityReport.created_at.desc(), CommunityReport.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    items = [
        {
            "id": str(r.id),
            "post_id": str(p.id),
            "topic_id": str(p.topic_id),
            "topic_title": topic_title,
            "post_number": p.post_number,
            "post_excerpt": p.content[:280],
            "reason": r.reason,
            "detail": r.detail,
            "reporter": reporter_name,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        }
        for r, p, topic_title, reporter_name, _ in rows
    ]
    total = int(rows[0].total) if rows else 0
    return ServiceResponse.ok({"items": items, "total": total, "limit": limit, "offset": offset})


async def resolve_report(db: AsyncSession, staff_id: UUID, report_id: UUID) -> ServiceResponse[dict[str, Any]]:
    from app.models.community import CommunityReport

    staff = await require_staff(db, staff_id)
    if not staff.success:
        return staff  # type: ignore[return-value]
    report = await db.scalar(select(CommunityReport).where(CommunityReport.id == report_id))
    if report is None:
        return ServiceResponse.fail("not_found", "Report not found.")
    if report.status != "resolved":
        report.status = "resolved"
        report.resolved_by_id = staff_id
        report.resolved_at = func.now()
        await db.commit()
    return ServiceResponse.ok({"id": str(report_id), "status": "resolved"})


# ── Search & views (S1.6) ────────────────────────────────────────────────────

VIEWS_HASH_KEY = "community:views"
_VIEW_DEDUPE_TTL_SECONDS = 600


async def search(
    db: AsyncSession, *, q: str, category_slug: str | None = None, limit: int = 20, offset: int = 0
) -> ServiceResponse[dict[str, Any]]:
    """Full-text over topic titles and post bodies, merged and ranked.

    Title hits point at the top of the thread (post 1); body hits carry the
    post_number so the client can land mid-thread. Same websearch grammar,
    ranking and <mark> snippets as the vault search."""
    q = q.strip()
    if not q:
        return ServiceResponse.fail("validation_failed", "Search for something.")
    tsquery = func.websearch_to_tsquery("english", q)
    headline_opts = "StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=2"

    title_sel = select(
        CommunityTopic.id.label("topic_id"),
        CommunityTopic.title.label("topic_title"),
        CommunityTopic.slug.label("topic_slug"),
        literal(1).label("post_number"),
        func.ts_headline("english", CommunityTopic.title, tsquery, headline_opts).label("snippet"),
        func.ts_rank_cd(CommunityTopic.title_tsv, tsquery).label("rank"),
    ).where(CommunityTopic.title_tsv.op("@@")(tsquery), CommunityTopic.is_deleted.is_(False))
    post_sel = (
        select(
            CommunityPost.topic_id.label("topic_id"),
            CommunityTopic.title.label("topic_title"),
            CommunityTopic.slug.label("topic_slug"),
            CommunityPost.post_number.label("post_number"),
            func.ts_headline("english", CommunityPost.content, tsquery, headline_opts).label("snippet"),
            func.ts_rank_cd(CommunityPost.content_tsv, tsquery).label("rank"),
        )
        .join(CommunityTopic, CommunityTopic.id == CommunityPost.topic_id)
        .where(
            CommunityPost.content_tsv.op("@@")(tsquery),
            CommunityPost.is_deleted.is_(False),
            CommunityTopic.is_deleted.is_(False),
        )
    )
    if category_slug is not None:
        cat_res = await get_category(db, category_slug)
        if not cat_res.success:
            return cat_res  # type: ignore[return-value]
        assert cat_res.data is not None
        title_sel = title_sel.where(CommunityTopic.category_id == cat_res.data.id)
        post_sel = post_sel.where(CommunityTopic.category_id == cat_res.data.id)

    union = title_sel.union_all(post_sel).subquery()
    stmt = (
        select(union, func.count().over().label("total"))
        .order_by(union.c.rank.desc(), union.c.topic_id.desc(), union.c.post_number)
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).all()
    items = [
        {
            "topic_id": str(r.topic_id),
            "topic_title": r.topic_title,
            "topic_slug": r.topic_slug,
            "post_number": int(r.post_number),
            "snippet": r.snippet,
            "rank": float(r.rank or 0),
        }
        for r in rows
    ]
    total = int(rows[0].total) if rows else 0
    return ServiceResponse.ok({"query": q, "items": items, "total": total, "limit": limit, "offset": offset})


async def record_view(topic_id: UUID, viewer_key: str) -> None:
    """Count a topic view without touching Postgres: SETNX dedupes one
    viewer for ten minutes, HINCRBY batches the rest for the beat flusher.
    Redis down → the view is simply not counted (never a 500)."""
    try:
        from app.core.redis import redis_control

        dedupe = f"community:viewdedupe:{topic_id}:{viewer_key}"
        if await redis_control.set(dedupe, "1", ex=_VIEW_DEDUPE_TTL_SECONDS, nx=True):
            await redis_control.hincrby(VIEWS_HASH_KEY, str(topic_id), 1)
    except Exception:
        pass


async def flush_views() -> int:
    """Drain the pending-views hash into view_count (the beat task's body).
    Rename-then-read: increments landing mid-flush go to a fresh hash."""
    from app.core.redis import redis_control

    tmp = f"{VIEWS_HASH_KEY}:flush"
    try:
        if not await redis_control.exists(VIEWS_HASH_KEY):
            return 0
        await redis_control.rename(VIEWS_HASH_KEY, tmp)
        pending = await redis_control.hgetall(tmp)
    except Exception:
        return 0
    if not pending:
        return 0
    from app.core.db import async_session_factory

    flushed = 0
    async with async_session_factory() as db:
        for topic_id, count in pending.items():
            tid = topic_id.decode() if isinstance(topic_id, bytes) else topic_id
            n = int(count)
            await db.execute(
                CommunityTopic.__table__.update()
                .where(CommunityTopic.id == UUID(tid))
                .values(view_count=CommunityTopic.view_count + n)
            )
            flushed += n
        await db.commit()
    import contextlib

    with contextlib.suppress(Exception):
        await redis_control.delete(tmp)
    return flushed
