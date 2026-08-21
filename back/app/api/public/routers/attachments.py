"""Public API — attachments (files and images embedded in notes)."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, UploadFile, status

from app.api.public.deps import DeleteUser, ReadUser, WriteUser
from app.api.public.schemas import AttachmentOut, Envelope, PresignedUrlData
from app.constants.limits import MAX_ATTACHMENT_SIZE_BYTES
from app.core.custom_exceptions import ValidationFailedError
from app.dependencies.db import SessionDep
from app.services import attachment_service

router = APIRouter()


@router.get("", summary="List attachments", response_model=Envelope[list[AttachmentOut]])
async def list_attachments(vault_id: UUID, user_id: ReadUser, db: SessionDep) -> Any:
    return {"data": (await attachment_service.list_attachments(db, vault_id, user_id)).unwrap()}


@router.post(
    "", summary="Upload an attachment", status_code=status.HTTP_201_CREATED, response_model=Envelope[AttachmentOut]
)
async def upload_attachment(vault_id: UUID, file: UploadFile, user_id: WriteUser, db: SessionDep) -> Any:
    """Multipart form, field `file`. Embed the result in a note with `![[filename]]`."""
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_ATTACHMENT_SIZE_BYTES:
            raise ValidationFailedError("Attachment is too large.")
        chunks.append(chunk)
    attachment = (
        await attachment_service.upload(
            db,
            vault_id,
            user_id,
            filename=file.filename or "file",
            content=b"".join(chunks),
            mime_type=file.content_type or "application/octet-stream",
        )
    ).unwrap()
    return {"data": attachment}


@router.get("/{attachment_id}/url", summary="Download URL", response_model=Envelope[PresignedUrlData])
async def presigned_url(vault_id: UUID, attachment_id: UUID, user_id: ReadUser, db: SessionDep) -> Any:
    """A time-limited URL to fetch the file's bytes from."""
    return {"data": (await attachment_service.presigned_url(db, vault_id, user_id, attachment_id)).unwrap()}


@router.delete("/{attachment_id}", summary="Delete an attachment")
async def delete_attachment(vault_id: UUID, attachment_id: UUID, user_id: DeleteUser, db: SessionDep) -> dict[str, Any]:
    (await attachment_service.delete_attachment(db, vault_id, user_id, attachment_id)).unwrap()
    return {"data": {"deleted": str(attachment_id)}}
