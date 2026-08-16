"""Note endpoints — nested under a vault."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.vaults import (
    NoteContentUpdateRequest,
    NoteCreateRequest,
    NoteMetaOut,
    NoteOut,
    NoteRenameRequest,
    NoteTagsRequest,
)
from app.services import folder_service, note_service

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_note(
    vault_id: UUID, body: NoteCreateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    folder_id = body.folder_id
    if folder_id is None and body.folder_path:
        folder_id = await folder_service.ensure_folder_path(db, vault_id, user_id, body.folder_path)
    note = (
        await note_service.create_note(
            db, vault_id, user_id, title=body.title, folder_id=folder_id, content=body.content
        )
    ).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.get("/by-path")
async def get_note_by_path(
    vault_id: UUID, user_id: CurrentUserId, db: SessionDep, path: str = Query(min_length=1)
) -> dict[str, Any]:
    note = (await note_service.get_note_by_path(db, vault_id, user_id, path)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.get("/{note_id}")
async def get_note(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    note = (await note_service.get_note(db, vault_id, user_id, note_id)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.put("/{note_id}/content")
async def update_note_content(
    vault_id: UUID, note_id: UUID, body: NoteContentUpdateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    note = (
        await note_service.update_content(
            db, vault_id, user_id, note_id, content=body.content, base_updated_at=body.base_updated_at
        )
    ).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.patch("/{note_id}/tags")
async def update_note_tags(
    vault_id: UUID, note_id: UUID, body: NoteTagsRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    note = (await note_service.set_tags(db, vault_id, user_id, note_id, add=body.add, remove=body.remove)).unwrap()
    return {"data": NoteOut.model_validate(note).model_dump()}


@router.patch("/{note_id}/rename")
async def rename_note(
    vault_id: UUID, note_id: UUID, body: NoteRenameRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    note = (
        await note_service.rename_note(
            db,
            vault_id,
            user_id,
            note_id,
            title=body.title,
            folder_id=body.folder_id,
            move_to_root=body.move_to_root,
        )
    ).unwrap()
    return {"data": NoteMetaOut.model_validate(note).model_dump()}


@router.delete("/{note_id}")
async def delete_note(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    (await note_service.delete_note(db, vault_id, user_id, note_id)).unwrap()
    return {"data": {"message": "Note deleted."}}
