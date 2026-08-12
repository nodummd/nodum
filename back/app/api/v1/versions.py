"""Note version history endpoints — list, fetch, restore."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.vaults import NoteOut
from app.services import version_service

router = APIRouter()


@router.get("")
async def list_versions(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    data = (await version_service.list_versions(db, vault_id, user_id, note_id)).unwrap()
    return {"data": data}


@router.get("/{version_id}")
async def get_version(
    vault_id: UUID, note_id: UUID, version_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    data = (await version_service.get_version(db, vault_id, user_id, note_id, version_id)).unwrap()
    return {"data": data}


@router.post("/{version_id}/restore")
async def restore_version(
    vault_id: UUID, note_id: UUID, version_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    note = (await version_service.restore_version(db, vault_id, user_id, note_id, version_id)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}
