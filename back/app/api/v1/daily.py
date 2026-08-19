"""Daily note & template endpoints."""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.vaults import NoteOut
from app.services import daily_note_service

router = APIRouter()


class ClockIn(BaseModel):
    """The caller's wall clock, as a naive local ISO timestamp — "today" and
    {{time}} are the person's, not the server's (which runs in UTC)."""

    now: datetime | None = None

    def local_now(self) -> datetime | None:
        if self.now is None:
            return None
        return self.now.replace(tzinfo=None) if self.now.tzinfo is not None else self.now


@router.post("/daily-note")
async def open_daily_note(
    vault_id: UUID, user_id: CurrentUserId, db: SessionDep, body: ClockIn | None = None
) -> dict[str, Any]:
    """Get or create today's daily note (applies the configured template)."""
    now = body.local_now() if body else None
    note = (await daily_note_service.open_daily_note(db, vault_id, user_id, now=now)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.get("/templates")
async def list_templates(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Notes inside the templates folder."""
    data = (await daily_note_service.list_templates(db, vault_id, user_id)).unwrap()
    return {"data": data}


@router.post("/notes/{note_id}/insert-template/{template_id}")
async def insert_template(
    vault_id: UUID,
    note_id: UUID,
    template_id: UUID,
    user_id: CurrentUserId,
    db: SessionDep,
    body: ClockIn | None = None,
) -> dict[str, Any]:
    """Insert a template into a note ({{date}}/{{time}}/{{title}} substituted)."""
    now = body.local_now() if body else None
    note = (await daily_note_service.insert_template(db, vault_id, user_id, note_id, template_id, now=now)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}
