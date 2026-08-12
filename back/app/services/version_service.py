"""Note version service — snapshots on save, list/get/restore."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.limits import NOTE_VERSION_INTERVAL_SECONDS, NOTE_VERSIONS_KEPT
from app.models.vaults import Note, NoteVersion
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault


async def maybe_snapshot(db: AsyncSession, note: Note, new_content: str) -> None:
    """Snapshot the note's CURRENT (pre-save) content before it is overwritten.

    Skipped when content is unchanged or the newest snapshot is younger than
    the snapshot interval — bounded churn under continuous autosave. Caller
    commits.
    """
    if note.content == new_content:
        return
    newest = await db.scalar(
        select(NoteVersion.created_at)
        .where(NoteVersion.note_id == note.id)
        .order_by(NoteVersion.created_at.desc())
        .limit(1)
    )
    if newest is not None and datetime.now(UTC) - newest < timedelta(seconds=NOTE_VERSION_INTERVAL_SECONDS):
        return
    db.add(NoteVersion(note_id=note.id, title=note.title, content=note.content))
    await _prune(db, note.id)


async def _prune(db: AsyncSession, note_id: UUID) -> None:
    """Keep only the newest NOTE_VERSIONS_KEPT snapshots for a note."""
    keep = (
        select(NoteVersion.id)
        .where(NoteVersion.note_id == note_id)
        .order_by(NoteVersion.created_at.desc())
        .limit(NOTE_VERSIONS_KEPT)
    ).scalar_subquery()
    await db.execute(delete(NoteVersion).where(NoteVersion.note_id == note_id, NoteVersion.id.not_in(keep)))


async def _owned_note(db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID) -> Note | None:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return None
    return await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id))


def _meta(v: NoteVersion) -> dict[str, Any]:
    return {
        "id": str(v.id),
        "title": v.title,
        "created_at": v.created_at.isoformat(),
        "size_chars": len(v.content),
    }


async def list_versions(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID
) -> ServiceResponse[list[dict[str, Any]]]:
    if await _owned_note(db, vault_id, user_id, note_id) is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    rows = (
        await db.scalars(
            select(NoteVersion).where(NoteVersion.note_id == note_id).order_by(NoteVersion.created_at.desc())
        )
    ).all()
    return ServiceResponse.ok([_meta(v) for v in rows])


async def get_version(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID, version_id: UUID
) -> ServiceResponse[dict[str, Any]]:
    if await _owned_note(db, vault_id, user_id, note_id) is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    version = await db.scalar(select(NoteVersion).where(NoteVersion.id == version_id, NoteVersion.note_id == note_id))
    if version is None:
        return ServiceResponse.fail("not_found", "Version not found.")
    return ServiceResponse.ok({**_meta(version), "content": version.content})


async def restore_version(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID, version_id: UUID
) -> ServiceResponse[Note]:
    """Restore a snapshot's content (title is untouched — content-only restore).

    The pre-restore content is always snapshotted first (interval ignored) so
    a restore is itself reversible.
    """
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id).with_for_update())
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    version = await db.scalar(select(NoteVersion).where(NoteVersion.id == version_id, NoteVersion.note_id == note_id))
    if version is None:
        return ServiceResponse.fail("not_found", "Version not found.")

    if note.content != version.content:
        db.add(NoteVersion(note_id=note.id, title=note.title, content=note.content))
        await _prune(db, note.id)

    from app.services.link_service import sync_note_aliases, sync_note_links
    from app.services.note_service import _apply_content
    from app.services.tag_service import sync_note_tags
    from app.services.vault_service import invalidate_tree_cache
    from app.utils.cache_utils import cache_delete, vault_graph_key

    if err := await _apply_content(note, version.content):
        return ServiceResponse.fail("validation_failed", err)
    await sync_note_links(db, note)
    await sync_note_tags(db, note)
    await sync_note_aliases(db, note)
    await db.commit()
    await db.refresh(note)
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(note)
