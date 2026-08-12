"""Bookmark endpoints — star/unstar notes, list per vault."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import delete, select

from app.core.custom_exceptions import NotFoundError
from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.models.bookmarks import Bookmark
from app.models.vaults import Note
from app.services.vault_service import get_owned_vault

router = APIRouter()


@router.get("")
async def list_bookmarks(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Bookmarked notes in this vault (newest first)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        raise NotFoundError("Vault not found.")
    rows = (
        await db.execute(
            select(Bookmark.note_id, Note.title, Note.path)
            .join(Note, Note.id == Bookmark.note_id)
            .where(Bookmark.user_id == user_id, Bookmark.vault_id == vault_id)
            .order_by(Bookmark.created_at.desc())
        )
    ).all()
    return {"data": [{"note_id": str(n), "title": t, "path": p} for n, t, p in rows]}


@router.put("/{note_id}", status_code=status.HTTP_201_CREATED)
async def add_bookmark(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Bookmark a note (idempotent)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        raise NotFoundError("Vault not found.")
    note = await db.scalar(select(Note.id).where(Note.id == note_id, Note.vault_id == vault_id))
    if note is None:
        raise NotFoundError("Note not found.")

    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from uuid_extensions import uuid7

    await db.execute(
        pg_insert(Bookmark)
        .values(id=uuid7(), user_id=user_id, vault_id=vault_id, note_id=note_id)
        .on_conflict_do_nothing(constraint="uq_bookmarks_user_note")
    )
    await db.commit()
    return {"data": {"bookmarked": True}}


@router.delete("/{note_id}")
async def remove_bookmark(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Remove a bookmark (idempotent)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        raise NotFoundError("Vault not found.")
    await db.execute(delete(Bookmark).where(Bookmark.user_id == user_id, Bookmark.note_id == note_id))
    await db.commit()
    return {"data": {"bookmarked": False}}
