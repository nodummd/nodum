"""Vault endpoints — CRUD, settings, file tree."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.vaults import VaultCreateRequest, VaultOut, VaultUpdateRequest
from app.services import vault_service

router = APIRouter()


@router.get("")
async def list_vaults(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    vaults = (await vault_service.list_vaults(db, user_id)).unwrap()
    return {"data": [VaultOut.model_validate(v).model_dump() for v in vaults]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_vault(body: VaultCreateRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    vault = (await vault_service.create_vault(db, user_id, name=body.name)).unwrap()
    return {"data": VaultOut.model_validate(vault).model_dump()}


@router.patch("/{vault_id}")
async def update_vault(
    vault_id: UUID, body: VaultUpdateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    if body.name is not None:
        vault = (await vault_service.rename_vault(db, vault_id, user_id, name=body.name)).unwrap()
    if body.settings is not None:
        vault = (
            await vault_service.update_vault_settings(db, vault_id, user_id, settings_patch=body.settings)
        ).unwrap()
    if body.name is None and body.settings is None:
        vault = (await vault_service.list_vaults(db, user_id)).unwrap()
        vault = next((v for v in vault if v.id == vault_id), None)
        if vault is None:
            from app.core.custom_exceptions import NotFoundError

            raise NotFoundError("Vault not found.")
    return {"data": VaultOut.model_validate(vault).model_dump()}


@router.delete("/{vault_id}")
async def delete_vault(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    (await vault_service.delete_vault(db, vault_id, user_id)).unwrap()
    return {"data": {"message": "Vault deleted."}}


@router.get("/{vault_id}/tree")
async def get_tree(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    tree = (await vault_service.get_tree(db, vault_id, user_id)).unwrap()
    return {"data": tree}
