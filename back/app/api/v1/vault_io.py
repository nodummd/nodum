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
from app.services import import_service, importers, vault_io_service

router = APIRouter()
#: Mounted without the vault prefix — the catalogue is the same for everyone
#: and the picker needs it before a vault is chosen.
catalog_router = APIRouter()


@catalog_router.get("/integrations")
async def list_integrations(_user_id: CurrentUserId) -> dict[str, Any]:
    """Every import source the picker can offer, with its export instructions.

    Authenticated but not vault-scoped: this is a static catalogue, and the
    modal opens before a target vault has necessarily been picked.
    """
    return {"data": {"sources": importers.catalog(), "categories": importers.CATEGORY_LABELS}}


@router.post("/import/{source_id}")
async def import_from_source(
    vault_id: UUID,
    source_id: str,
    files: list[UploadFile],
    user_id: CurrentUserId,
    db: SessionDep,
) -> dict[str, Any]:
    """Import an export from a named source into this vault.

    One endpoint for every source: the source id selects the converter, and
    everything downstream — folders, collisions, cross-batch wikilink
    resolution, attachments — is the same pipeline a plain zip goes through.
    """
    if not files:
        raise ValidationFailedError("No files were selected.")

    uploads: list[tuple[str, bytes]] = []
    total = 0
    for upload in files:
        # Checked before the read, like the other import routes: measuring
        # after reading has already committed the allocation the cap exists
        # to prevent.
        total += upload.size or 0
        if total > MAX_IMPORT_ZIP_SIZE_BYTES:
            raise ValidationFailedError("That export is too large to import in one go.")
        content = await upload.read()
        if len(content) == 0:
            continue
        name = (upload.filename or "upload").replace("\\", "/").lstrip("/")
        uploads.append((name, content))

    stats = (await import_service.run_import(db, vault_id, user_id, source_id=source_id, uploads=uploads)).unwrap()
    return {"data": stats}


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
    # Check BEFORE reading. Starlette's multipart parser has already counted
    # the part (UploadFile.size is exact by the time a handler runs), so this
    # is free — whereas reading first and measuring after commits the whole
    # allocation the cap exists to prevent, and a multi-GB body OOM-kills the
    # worker before any validation runs.
    if (file.size or 0) > MAX_IMPORT_ZIP_SIZE_BYTES:
        raise ValidationFailedError("Archive is too large.")
    archive = await file.read()
    # Fallback for a hand-constructed UploadFile with no size (unit tests).
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
            # Per-file, and before the read: the running total was already
            # checked inside this loop, but a single oversized member was read
            # into memory whole before `total` was ever consulted.
            total += upload.size or 0
            if total > MAX_IMPORT_ZIP_SIZE_BYTES:
                raise ValidationFailedError("Selection is too large.")
            content = await upload.read()
            # filename carries the relative path; posixpath keeps separators sane
            name = (upload.filename or "file").replace("\\", "/").lstrip("/")
            if not name or name.endswith("/"):
                continue
            zf.writestr(name, content)

    stats = (await vault_io_service.import_zip(db, vault_id, user_id, archive=buffer.getvalue())).unwrap()
    return {"data": stats}
