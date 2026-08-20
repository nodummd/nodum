"""Public API — tags."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.api.public.deps import ReadUser
from app.api.public.schemas import Envelope, TagNotesData, TagOut
from app.dependencies.db import SessionDep
from app.services import tag_service

router = APIRouter()


@router.get("", summary="List tags", response_model=Envelope[list[TagOut]])
async def list_tags(vault_id: UUID, user_id: ReadUser, db: SessionDep) -> Any:
    """Every tag in the vault with how many notes carry it."""
    return {"data": (await tag_service.list_tags(db, vault_id, user_id)).unwrap()}


@router.get("/{tag_name:path}", summary="Notes with a tag", response_model=Envelope[TagNotesData])
async def notes_by_tag(vault_id: UUID, tag_name: str, user_id: ReadUser, db: SessionDep) -> Any:
    """Notes carrying `tag_name` (leading `#` optional). Nested tags match by prefix: `a` matches `a/b`."""
    notes = (await tag_service.notes_by_tag(db, vault_id, user_id, tag_name)).unwrap()
    return {"data": {"name": tag_name.strip().lstrip("#").lower(), "notes": notes}}
