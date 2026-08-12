"""Daily note & template endpoints."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.vaults import NoteOut
from app.services import daily_note_service

router = APIRouter()


@router.post("/daily-note")
async def open_daily_note(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Get or create today's daily note (applies the configured template)."""
    note = (await daily_note_service.open_daily_note(db, vault_id, user_id)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.get("/templates")
async def list_templates(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Notes inside the templates folder."""
    data = (await daily_note_service.list_templates(db, vault_id, user_id)).unwrap()
    return {"data": data}


@router.post("/notes/{note_id}/insert-template/{template_id}")
async def insert_template(
    vault_id: UUID, note_id: UUID, template_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """Insert a template into a note ({{date}}/{{time}}/{{title}} substituted)."""
    note = (await daily_note_service.insert_template(db, vault_id, user_id, note_id, template_id)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}
