"""Attachment service — S3-backed uploads with per-vault filename identity."""

import asyncio
import contextlib
import os
import re
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.limits import MAX_ATTACHMENT_SIZE_BYTES
from app.core.s3 import get_s3_client
from app.models.attachments import Attachment
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault
from app.settings import get_settings

_SAFE_FILENAME_RE = re.compile(r"[^\w.\- ()]", re.UNICODE)

# Extension → canonical MIME. The client's Content-Type is NEVER trusted: a
# browser (or a crafted request) can claim anything, and the stored type is what
# we later hand back to viewers. Anything not listed here is refused.
# Deliberately absent: .svg and .html — both execute script in the origin that
# serves them, and object storage serves them from its own origin.
ALLOWED_ATTACHMENT_TYPES: dict[str, str] = {
    # images
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    "bmp": "image/bmp",
    "ico": "image/x-icon",
    # documents
    "pdf": "application/pdf",
    "txt": "text/plain",
    "md": "text/markdown",
    "csv": "text/csv",
    "json": "application/json",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    # audio / video
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    # archives
    "zip": "application/zip",
}

# Types safe to render in a browser tab; everything else downloads instead of
# being interpreted (defence in depth on top of the allowlist).
_INLINE_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
    "image/x-icon", "application/pdf", "text/plain", "text/markdown", "text/csv",
    "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "video/mp4", "video/webm",
    "video/quicktime",
}

# Leading bytes that must match when the extension claims a sniffable format —
# stops "payload.exe renamed to .png" from being stored as an image.
_MAGIC: dict[str, tuple[bytes, ...]] = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "application/pdf": (b"%PDF-",),
    "application/zip": (b"PK\x03\x04", b"PK\x05\x06"),
}


def _resolve_type(filename: str, content: bytes) -> tuple[str, str] | None:
    """(mime, disposition) for an allowed file, or None when it must be refused."""
    ext = filename.rpartition(".")[2].lower() if "." in filename else ""
    mime = ALLOWED_ATTACHMENT_TYPES.get(ext)
    if mime is None:
        return None
    expected = _MAGIC.get(mime)
    if expected and not content.startswith(expected):
        return None
    # OOXML files are zips; verify the container rather than the office type.
    if ext in {"docx", "xlsx", "pptx"} and not content.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        return None
    return mime, "inline" if mime in _INLINE_TYPES else "attachment"


def _sanitize_filename(filename: str) -> str:
    name = os.path.basename(filename or "file").strip()
    name = _SAFE_FILENAME_RE.sub("_", name)
    return name[:200] or "file"


async def _unique_filename(db: AsyncSession, vault_id: UUID, filename: str) -> str:
    """Append ' 1', ' 2', … before the extension until the name is free (Obsidian style)."""
    stem, dot, ext = filename.rpartition(".")
    if not dot:
        stem, ext = filename, ""
    candidate = filename
    n = 0
    while await db.scalar(
        select(Attachment.id).where(Attachment.vault_id == vault_id, Attachment.filename == candidate)
    ):
        n += 1
        candidate = f"{stem} {n}.{ext}" if ext else f"{stem} {n}"
    return candidate


async def upload(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    *,
    filename: str,
    content: bytes,
    mime_type: str,
) -> ServiceResponse[Attachment]:
    """Store the file in S3 and record it."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    if len(content) > MAX_ATTACHMENT_SIZE_BYTES:
        mb = MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)
        return ServiceResponse.fail(
            "validation_failed",
            f"“{filename}” is {len(content) / (1024 * 1024):.1f} MB — the limit is {mb:.0f} MB.",
        )
    if not content:
        return ServiceResponse.fail("validation_failed", "Attachment is empty.")

    settings = get_settings()
    safe_name = await _unique_filename(db, vault_id, _sanitize_filename(filename))
    # The extension decides the stored type (never the client's Content-Type),
    # and the leading bytes must agree with it.
    resolved = _resolve_type(safe_name, content)
    if resolved is None:
        return ServiceResponse.fail(
            "validation_failed",
            f"“{filename}” is not an accepted file type.",
        )
    stored_mime, disposition = resolved
    s3_key = f"vaults/{vault_id}/attachments/{uuid4().hex}/{safe_name}"

    def _put() -> None:
        get_s3_client().put_object(
            Bucket=settings.S3_BUCKET_NAME,
            Key=s3_key,
            Body=content,
            ContentType=stored_mime,
            # Non-previewable types download rather than render, so a served
            # object can never be interpreted as active content.
            ContentDisposition=f'{disposition}; filename="{safe_name}"',
        )

    await asyncio.to_thread(_put)

    attachment = Attachment(
        vault_id=vault_id,
        filename=safe_name,
        s3_key=s3_key,
        mime_type=stored_mime,
        size_bytes=len(content),
    )
    db.add(attachment)
    try:
        await db.commit()
    except Exception:
        # DB failed after the S3 put — clean up the orphaned object
        await db.rollback()

        def _cleanup() -> None:
            get_s3_client().delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)

        with contextlib.suppress(Exception):  # orphan is tolerable; the DB failure is what matters
            await asyncio.to_thread(_cleanup)
        raise
    await db.refresh(attachment)
    return ServiceResponse.ok(attachment)


async def list_attachments(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[list[Attachment]]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    rows = await db.execute(
        select(Attachment).where(Attachment.vault_id == vault_id).order_by(Attachment.created_at.desc())
    )
    return ServiceResponse.ok(list(rows.scalars()))


async def _get_owned_attachment(
    db: AsyncSession, vault_id: UUID, user_id: UUID, attachment_id: UUID
) -> Attachment | None:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return None
    return await db.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.vault_id == vault_id))


async def presigned_url(
    db: AsyncSession, vault_id: UUID, user_id: UUID, attachment_id: UUID
) -> ServiceResponse[dict[str, Any]]:
    """Time-limited download URL, rewritten to the public MinIO endpoint."""
    attachment = await _get_owned_attachment(db, vault_id, user_id, attachment_id)
    if attachment is None:
        return ServiceResponse.fail("not_found", "Attachment not found.")

    settings = get_settings()

    def _sign() -> str:
        return get_s3_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET_NAME, "Key": attachment.s3_key},
            ExpiresIn=settings.S3_PRESIGNED_URL_EXPIRY_TIME,
        )

    url = await asyncio.to_thread(_sign)
    # Containers sign against the internal endpoint; browsers need the public one.
    if settings.S3_PUBLIC_URL and settings.S3_ENDPOINT_URL != settings.S3_PUBLIC_URL:
        url = url.replace(settings.S3_ENDPOINT_URL, settings.S3_PUBLIC_URL, 1)
    return ServiceResponse.ok({"url": url, "expires_in": settings.S3_PRESIGNED_URL_EXPIRY_TIME})


async def resolve_by_filename(
    db: AsyncSession, vault_id: UUID, user_id: UUID, filename: str
) -> ServiceResponse[dict[str, Any]]:
    """Resolve ![[filename]] embeds → presigned URL."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    attachment = await db.scalar(
        select(Attachment).where(Attachment.vault_id == vault_id, Attachment.filename == filename)
    )
    if attachment is None:
        return ServiceResponse.fail("not_found", "Attachment not found.")
    return await presigned_url(db, vault_id, user_id, attachment.id)


async def delete_attachment(
    db: AsyncSession, vault_id: UUID, user_id: UUID, attachment_id: UUID
) -> ServiceResponse[None]:
    attachment = await _get_owned_attachment(db, vault_id, user_id, attachment_id)
    if attachment is None:
        return ServiceResponse.fail("not_found", "Attachment not found.")

    settings = get_settings()
    s3_key = attachment.s3_key

    # DB row first (a missing row with a stray S3 object is tolerable;
    # a row pointing at a deleted object is not), then best-effort S3.
    await db.delete(attachment)
    await db.commit()

    def _delete() -> None:
        get_s3_client().delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)

    with contextlib.suppress(Exception):
        await asyncio.to_thread(_delete)
    return ServiceResponse.ok(None)
