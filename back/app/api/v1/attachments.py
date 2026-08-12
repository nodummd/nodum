"""Attachment endpoints — upload, list, resolve, presigned download, delete."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, UploadFile, status

from app.constants.limits import MAX_ATTACHMENT_SIZE_BYTES
from app.core.custom_exceptions import ValidationFailedError
from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import attachment_service

router = APIRouter()


def _serialize(a: Any) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "filename": a.filename,
        "mime_type": a.mime_type,
        "size_bytes": a.size_bytes,
        "created_at": a.created_at.isoformat(),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    vault_id: UUID, file: UploadFile, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """Upload a file (multipart form field ``file``)."""
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_SIZE_BYTES:
        raise ValidationFailedError("Attachment is too large.")
    attachment = (
        await attachment_service.upload(
            db,
            vault_id,
            user_id,
            filename=file.filename or "file",
            content=content,
            mime_type=file.content_type or "application/octet-stream",
        )
    ).unwrap()
    return {"data": _serialize(attachment)}


@router.get("")
async def list_attachments(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    items = (await attachment_service.list_attachments(db, vault_id, user_id)).unwrap()
    return {"data": [_serialize(a) for a in items]}


@router.get("/resolve")
async def resolve_by_filename(
    vault_id: UUID, user_id: CurrentUserId, db: SessionDep, filename: str = Query(min_length=1)
) -> dict[str, Any]:
    """Resolve an ![[embed]] filename to a presigned URL."""
    data = (await attachment_service.resolve_by_filename(db, vault_id, user_id, filename)).unwrap()
    return {"data": data}


@router.get("/{attachment_id}/url")
async def download_url(
    vault_id: UUID, attachment_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    data = (await attachment_service.presigned_url(db, vault_id, user_id, attachment_id)).unwrap()
    return {"data": data}


@router.delete("/{attachment_id}")
async def delete_attachment(
    vault_id: UUID, attachment_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    (await attachment_service.delete_attachment(db, vault_id, user_id, attachment_id)).unwrap()
    return {"data": {"message": "Attachment deleted."}}
