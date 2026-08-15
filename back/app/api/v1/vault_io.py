"""Vault import/export endpoints."""

import io
import zipfile
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


@router.post("/import-files")
async def import_files(
    vault_id: UUID, files: list[UploadFile], user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """Import a picked folder (or loose files) without the user zipping first.

    The browser sends each file with its vault-relative path as the filename
    (``webkitRelativePath``). Those are packed into an in-memory zip so the
    whole import pipeline — root unwrapping, folder recreation, two-pass
    wikilink resolution, attachments, PDF text — is exactly the same code path
    as a zip upload.
    """
    if not files:
        raise ValidationFailedError("No files were selected.")

    buffer = io.BytesIO()
    total = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for upload in files:
            content = await upload.read()
            total += len(content)
            if total > MAX_IMPORT_ZIP_SIZE_BYTES:
                raise ValidationFailedError("Selection is too large.")
            # filename carries the relative path; posixpath keeps separators sane
            name = (upload.filename or "file").replace("\\", "/").lstrip("/")
            if not name or name.endswith("/"):
                continue
            zf.writestr(name, content)

    stats = (
        await vault_io_service.import_zip(db, vault_id, user_id, archive=buffer.getvalue())
    ).unwrap()
    return {"data": stats}
