"""Community forum endpoints.

The read side is anonymous — the forum is publicly readable like the docs,
so those routes take no auth dependency at all. Writes require a session
(CurrentUserId); ownership and staff rules live in the service.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import community_service

router = APIRouter()


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
    category: str | None = Query(default=None, description="A category slug; omit for all."),
    top: str | None = Query(default=None, pattern="^(week|month|all)$", description="Top instead of Latest."),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Latest (default), Top (?top=week|month|all), optionally within a category
    — where pinned topics float first."""
    return {
        "data": (
            await community_service.list_topics(db, category_slug=category, top_window=top, limit=limit, offset=offset)
        ).unwrap()
    }


@router.get("/topics/{topic_id}")
async def get_topic(topic_id: UUID, db: SessionDep) -> dict[str, Any]:
    return {"data": (await community_service.get_topic(db, topic_id)).unwrap()}


@router.get("/topics/{topic_id}/posts")
async def list_posts(
    topic_id: UUID,
    db: SessionDep,
    after: int = Query(default=0, ge=0, description="The last post_number you have; 0 from the top."),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    """The thread, keyset-paginated: ask again with `after` = the last
    `post_number` received while `has_more` is true. Deleted posts are
    placeholders — the numbering never shifts under you."""
    return {"data": (await community_service.list_posts(db, topic_id, after=after, limit=limit)).unwrap()}


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
