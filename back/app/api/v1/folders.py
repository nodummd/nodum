"""Folder endpoints — nested under a vault."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.vaults import FolderCreateRequest, FolderMoveRequest, FolderOut, FolderRenameRequest
from app.services import folder_service

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_folder(
    vault_id: UUID, body: FolderCreateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    folder = (
        await folder_service.create_folder(db, vault_id, user_id, name=body.name, parent_id=body.parent_id)
    ).unwrap()
    return {"data": FolderOut.model_validate(folder).model_dump()}


@router.patch("/{folder_id}/rename")
async def rename_folder(
    vault_id: UUID, folder_id: UUID, body: FolderRenameRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    folder = (await folder_service.rename_folder(db, vault_id, user_id, folder_id, name=body.name)).unwrap()
    return {"data": FolderOut.model_validate(folder).model_dump()}


@router.patch("/{folder_id}/move")
async def move_folder(
    vault_id: UUID, folder_id: UUID, body: FolderMoveRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    folder = (
        await folder_service.move_folder(db, vault_id, user_id, folder_id, new_parent_id=body.new_parent_id)
    ).unwrap()
    return {"data": FolderOut.model_validate(folder).model_dump()}


@router.delete("/{folder_id}")
async def delete_folder(vault_id: UUID, folder_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    (await folder_service.delete_folder(db, vault_id, user_id, folder_id)).unwrap()
    return {"data": {"message": "Folder deleted."}}
