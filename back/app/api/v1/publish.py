"""Publish endpoints — share tokens for notes + the public read route."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import delete, select

from app.core.custom_exceptions import NotFoundError
from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.models.publications import Publication
from app.models.vaults import Note
from app.services.vault_service import get_owned_vault

router = APIRouter()
public_router = APIRouter()


async def _owned_note(db: SessionDep, vault_id: UUID, note_id: UUID, user_id: UUID) -> Note:
    if await get_owned_vault(db, vault_id, user_id) is None:
        raise NotFoundError("Vault not found.")
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id))
    if note is None:
        raise NotFoundError("Note not found.")
    return note


@router.post("/{note_id}/publish", status_code=status.HTTP_201_CREATED)
async def publish_note(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Publish a note (idempotent — returns the existing token if already public)."""
    await _owned_note(db, vault_id, note_id, user_id)
    existing = await db.scalar(select(Publication).where(Publication.note_id == note_id))
    if existing:
        return {"data": {"token": existing.token, "published": True}}

    publication = Publication(note_id=note_id, vault_id=vault_id, user_id=user_id)
    db.add(publication)
    await db.commit()
    await db.refresh(publication)
    return {"data": {"token": publication.token, "published": True}}


@router.get("/{note_id}/publish")
async def publish_status(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Is this note published, and under which token?"""
    await _owned_note(db, vault_id, note_id, user_id)
    existing = await db.scalar(select(Publication).where(Publication.note_id == note_id))
    return {"data": {"published": existing is not None, "token": existing.token if existing else None}}


@router.delete("/{note_id}/publish")
async def unpublish_note(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Remove the public link (idempotent)."""
    await _owned_note(db, vault_id, note_id, user_id)
    await db.execute(delete(Publication).where(Publication.note_id == note_id))
    await db.commit()
    return {"data": {"published": False}}


# ── Public (no auth) ─────────────────────────────────────────────────────────


@public_router.get("/{token}")
async def read_public_note(token: str, db: SessionDep) -> dict[str, Any]:
    """Public read of a published note. No authentication — token is the secret."""
    row = (
        await db.execute(
            select(Note.title, Note.content, Note.updated_at, Publication.created_at)
            .join(Note, Note.id == Publication.note_id)
            .where(Publication.token == token)
        )
    ).first()
    if row is None:
        raise NotFoundError("This page does not exist (or was unpublished).")
    title, content, updated_at, published_at = row
    return {
        "data": {
            "title": title,
            "content": content,
            "updated_at": updated_at.isoformat(),
            "published_at": published_at.isoformat(),
        }
    }
