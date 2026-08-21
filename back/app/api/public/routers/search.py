"""Public API — full-text search and fuzzy title matching."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query

from app.api.public.deps import ReadUser
from app.api.public.schemas import Envelope, QuickSwitchHit, SearchData
from app.dependencies.db import SessionDep
from app.services import search_service

router = APIRouter()


@router.get("/search", summary="Search notes", response_model=Envelope[SearchData])
async def search_notes(
    vault_id: UUID,
    user_id: ReadUser,
    db: SessionDep,
    q: str = Query(
        min_length=1,
        description='Words to find. Operators: `path:Folder` `file:Name` `tag:#name` `-not-this` `"a phrase"`.',
    ),
    sort: str = Query(default="relevance", pattern="^(relevance|updated|created|title)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Any:
    """Ranked full-text search. Hits carry a snippet with `<mark>` around the matches."""
    return {
        "data": (
            await search_service.search_notes(db, vault_id, user_id, q=q, sort=sort, limit=limit, offset=offset)
        ).unwrap()
    }


@router.get("/quick-switch", summary="Fuzzy title match", response_model=Envelope[list[QuickSwitchHit]])
async def quick_switch(
    vault_id: UUID,
    user_id: ReadUser,
    db: SessionDep,
    q: str = Query(default="", description="Part of a title (or alias). Empty returns the most recent notes."),
    limit: int = Query(default=10, ge=1, le=25),
) -> Any:
    """What the in-app Cmd+O switcher uses — cheap fuzzy matching on titles and aliases."""
    return {"data": (await search_service.quick_switch(db, vault_id, user_id, q=q, limit=limit)).unwrap()}
