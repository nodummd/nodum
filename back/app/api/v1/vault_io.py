"""Vault import/export endpoints."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, UploadFile
from fastapi.responses import Response

from app.constants.limits import MAX_IMPORT_ZIP_SIZE_BYTES
from app.core.custom_exceptions import ValidationFailedError
from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import vault_io_service

router = APIRouter()


@router.get("/export")
async def export_vault(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> Response:
    """Download the whole vault as a zip of markdown files."""
    data = (await vault_io_service.export_zip(db, vault_id, user_id)).unwrap()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="nodum-vault.zip"'},
    )


@router.post("/import")
async def import_vault(vault_id: UUID, file: UploadFile, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Import a zip of markdown files (an Obsidian vault works as-is)."""
    archive = await file.read()
    if len(archive) > MAX_IMPORT_ZIP_SIZE_BYTES:
        raise ValidationFailedError("Archive is too large.")
    stats = (await vault_io_service.import_zip(db, vault_id, user_id, archive=archive)).unwrap()
    return {"data": stats}
