"""Community forum endpoints.

The read side is anonymous — the forum is publicly readable like the docs,
so those routes take no auth dependency at all. Writes require a session
(CurrentUserId); ownership and staff rules live in the service.
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field

from app.dependencies.auth import CurrentUserId, validate_access_token
from app.dependencies.db import SessionDep
from app.services import community_service

router = APIRouter()


async def get_optional_user_id(request: Request) -> UUID | None:
    """The viewer if they sent a valid token, else None — public reads never
    401: an expired session downgrades to the anonymous view."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        return await validate_access_token(header.removeprefix("Bearer ").strip())
    except Exception:
        return None


OptionalUserId = Annotated[UUID | None, Depends(get_optional_user_id)]


class TopicCreateRequest(BaseModel):
    category: str = Field(min_length=1, max_length=100, description="Category slug.")
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1)


class PostCreateRequest(BaseModel):
    content: str = Field(min_length=1)


class PostEditRequest(BaseModel):
    content: str = Field(min_length=1)


@router.get("/categories")
async def list_categories(db: SessionDep) -> dict[str, Any]:
    """Every category with its counters, in rail order."""
    return {"data": (await community_service.list_categories(db)).unwrap()}


@router.get("/topics")
async def list_topics(
    db: SessionDep,
    viewer: OptionalUserId = None,
    category: str | None = Query(default=None, description="A category slug; omit for all."),
    top: str | None = Query(default=None, pattern="^(week|month|all)$", description="Top instead of Latest."),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Latest (default), Top (?top=week|month|all), optionally within a category
    — where pinned topics float first. Signed-in viewers get `unread` flags."""
    data = (
        await community_service.list_topics(db, category_slug=category, top_window=top, limit=limit, offset=offset)
    ).unwrap()
    if viewer is not None and data["items"]:
        unread = await community_service.unread_map(db, viewer, [UUID(t["id"]) for t in data["items"]])
        for t in data["items"]:
            t["unread"] = unread.get(t["id"], True)
    return {"data": data}


@router.get("/topics/{topic_id}")
async def get_topic(topic_id: UUID, db: SessionDep, request: Request, viewer: OptionalUserId = None) -> dict[str, Any]:
    data = (await community_service.get_topic(db, topic_id)).unwrap()
    # Count the view after the topic proved real — Redis-batched, deduped
    # per viewer (or per address for the logged-out) for ten minutes.
    viewer_key = str(viewer) if viewer else (request.client.host if request.client else "anon")
    await community_service.record_view(topic_id, viewer_key)
    return {"data": data}


@router.get("/topics/{topic_id}/posts")
async def list_posts(
    topic_id: UUID,
    db: SessionDep,
    viewer: OptionalUserId = None,
    after: int = Query(default=0, ge=0, description="The last post_number you have; 0 from the top."),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    """The thread, keyset-paginated: ask again with `after` = the last
    `post_number` received while `has_more` is true. Deleted posts are
    placeholders — the numbering never shifts under you. Signed-in viewers
    get `liked_by_viewer` on each post."""
    data = (await community_service.list_posts(db, topic_id, after=after, limit=limit)).unwrap()
    if viewer is not None and data["items"]:
        liked = await community_service.liked_post_ids(
            db, viewer, [UUID(p["id"]) for p in data["items"] if not p["is_deleted"]]
        )
        for p in data["items"]:
            if not p["is_deleted"]:
                p["liked_by_viewer"] = p["id"] in liked
    return {"data": data}


@router.get("/users/{user_id}")
async def get_profile(user_id: UUID, db: SessionDep) -> dict[str, Any]:
    """A member's public profile: identity, join date, forum stats, recent topics."""
    return {"data": (await community_service.get_profile(db, user_id)).unwrap()}


# ── Writes ───────────────────────────────────────────────────────────────────


@router.post("/topics", status_code=status.HTTP_201_CREATED)
async def create_topic(body: TopicCreateRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Start a topic (the content becomes its opening post)."""
    return {
        "data": (
            await community_service.create_topic(
                db, user_id, category_slug=body.category, title=body.title, content=body.content
            )
        ).unwrap()
    }


@router.post("/topics/{topic_id}/posts", status_code=status.HTTP_201_CREATED)
async def create_post(
    topic_id: UUID, body: PostCreateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """Reply to a topic."""
    return {"data": (await community_service.create_post(db, user_id, topic_id, content=body.content)).unwrap()}


@router.patch("/posts/{post_id}")
async def edit_post(post_id: UUID, body: PostEditRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Edit your own post (marks it edited)."""
    return {"data": (await community_service.edit_post(db, user_id, post_id, content=body.content)).unwrap()}


@router.delete("/posts/{post_id}")
async def delete_post(post_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Delete your own reply (a numbered placeholder remains)."""
    return {"data": (await community_service.delete_post(db, user_id, post_id)).unwrap()}


@router.delete("/topics/{topic_id}")
async def delete_topic(topic_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Delete your own topic — only while nobody has replied."""
    return {"data": (await community_service.delete_topic(db, user_id, topic_id)).unwrap()}


@router.put("/posts/{post_id}/like")
async def like_post(post_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Like a post. Idempotent — liking twice counts once."""
    return {"data": (await community_service.like_post(db, user_id, post_id)).unwrap()}


@router.delete("/posts/{post_id}/like")
async def unlike_post(post_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Take a like back. Never liked it? Still fine."""
    return {"data": (await community_service.unlike_post(db, user_id, post_id)).unwrap()}


class MarkReadRequest(BaseModel):
    post_number: int = Field(ge=1, description="The highest post number now on your screen.")


@router.put("/topics/{topic_id}/read")
async def mark_read(topic_id: UUID, body: MarkReadRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Move your read pointer — it only ever moves forward."""
    return {"data": (await community_service.mark_read(db, user_id, topic_id, post_number=body.post_number)).unwrap()}


# ── Moderation (staff) ───────────────────────────────────────────────────────


class TopicModerateRequest(BaseModel):
    pinned: bool | None = None
    locked: bool | None = None
    title: str | None = Field(default=None, max_length=300)
    category: str | None = Field(default=None, max_length=100, description="Move to this category slug.")


class ReportCreateRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=50)
    detail: str = Field(default="", max_length=2000)


@router.patch("/topics/{topic_id}")
async def moderate_topic(
    topic_id: UUID, body: TopicModerateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """Staff: pin, lock, retitle or recategorize — any subset at once."""
    return {
        "data": (
            await community_service.moderate_topic(
                db,
                user_id,
                topic_id,
                pinned=body.pinned,
                locked=body.locked,
                title=body.title,
                category_slug=body.category,
            )
        ).unwrap()
    }


@router.delete("/mod/posts/{post_id}")
async def staff_delete_post(post_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Staff: soft-delete anyone's reply (a numbered placeholder remains)."""
    (await community_service.require_staff(db, user_id)).unwrap()
    return {"data": (await community_service.delete_post(db, user_id, post_id, as_staff=True)).unwrap()}


@router.delete("/mod/topics/{topic_id}")
async def staff_delete_topic(topic_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Staff: soft-delete a whole topic, replies and all."""
    (await community_service.require_staff(db, user_id)).unwrap()
    return {"data": (await community_service.delete_topic(db, user_id, topic_id, as_staff=True)).unwrap()}


@router.post("/posts/{post_id}/report", status_code=status.HTTP_201_CREATED)
async def report_post(
    post_id: UUID, body: ReportCreateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """Flag a post for staff. Once per post per person."""
    return {
        "data": (
            await community_service.report_post(db, user_id, post_id, reason=body.reason, detail=body.detail)
        ).unwrap()
    }


@router.get("/mod/reports")
async def list_reports(
    user_id: CurrentUserId,
    db: SessionDep,
    report_status: str = Query(default="open", alias="status", pattern="^(open|resolved)$"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Staff: the report queue."""
    return {
        "data": (
            await community_service.list_reports(db, user_id, status=report_status, limit=limit, offset=offset)
        ).unwrap()
    }


@router.post("/mod/reports/{report_id}/resolve")
async def resolve_report(report_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Staff: mark a report handled."""
    return {"data": (await community_service.resolve_report(db, user_id, report_id)).unwrap()}


@router.get("/search")
async def search(
    db: SessionDep,
    q: str = Query(min_length=1, max_length=200),
    category: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Full-text search over topics and posts — websearch grammar, ranked,
    with <mark> snippets. Title hits land at the top of the thread, body
    hits carry their post_number."""
    return {
        "data": (await community_service.search(db, q=q, category_slug=category, limit=limit, offset=offset)).unwrap()
    }
