"""Search & tag endpoints."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import search_service, tag_service

router = APIRouter()


@router.get("/search")
async def search(
    vault_id: UUID,
    user_id: CurrentUserId,
    db: SessionDep,
    q: str = Query(min_length=1, max_length=500),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Full-text search with operators (path:, file:, tag:, "phrases", -exclusions)."""
    data = (await search_service.search_notes(db, vault_id, user_id, q=q, limit=limit, offset=offset)).unwrap()
    return {"data": data}


@router.get("/quick-switch")
async def quick_switch(
    vault_id: UUID,
    user_id: CurrentUserId,
    db: SessionDep,
    q: str = Query(default="", max_length=255),
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    """Fuzzy title matching for the quick switcher; empty query returns recents."""
    data = (await search_service.quick_switch(db, vault_id, user_id, q=q, limit=limit)).unwrap()
    return {"data": data}


@router.get("/tags")
async def list_tags(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """All tags with usage counts."""
    data = (await tag_service.list_tags(db, vault_id, user_id)).unwrap()
    return {"data": data}


@router.get("/tags/{tag_name:path}/notes")
async def notes_by_tag(vault_id: UUID, tag_name: str, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Notes carrying a tag (nested tags match by prefix)."""
    data = (await tag_service.notes_by_tag(db, vault_id, user_id, tag_name)).unwrap()
    return {"data": data}
