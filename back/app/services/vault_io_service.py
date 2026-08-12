"""Vault import/export — plain markdown in, plain markdown out (no lock-in).

Export: zip of ``<path>.md`` files mirroring the folder tree.
Import: any zip of ``.md`` files (an Obsidian vault works as-is). Two passes:
create folders+notes first, then resolve wikilinks across the whole batch so
cross-references land regardless of zip entry order. Name collisions get an
Obsidian-style ``<name> 1`` suffix. Non-markdown entries are counted and
skipped (attachment import is a follow-up).
"""

import io
import posixpath
import zipfile
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.limits import MAX_IMPORT_ZIP_SIZE_BYTES, MAX_NOTE_SIZE_BYTES
from app.core.logging import get_logger
from app.models.vaults import Note
from app.services import note_service
from app.services.daily_note_service import _ensure_folder
from app.services.link_service import resolve_links_for_new_note, sync_note_links
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault, invalidate_tree_cache
from app.utils.cache_utils import cache_delete, vault_graph_key
from app.utils.path_utils import validate_segment

logger = get_logger("vault_io")


async def export_zip(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[bytes]:
    """Zip every note as ``<path>.md`` (folder structure preserved)."""
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    rows = (await db.execute(select(Note.path, Note.content).where(Note.vault_id == vault_id))).all()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in rows:
            zf.writestr(f"{path}.md", content)
    return ServiceResponse.ok(buffer.getvalue())


def _sanitize_segment(name: str) -> str:
    """Best-effort cleanup so almost any zip imports (strip forbidden chars)."""
    cleaned = "".join(ch for ch in name if ch not in '*"\\/<>:|?#^[]').strip()
    return cleaned or "Untitled"


async def import_zip(
    db: AsyncSession, vault_id: UUID, user_id: UUID, *, archive: bytes
) -> ServiceResponse[dict[str, Any]]:
    """Import all ``.md`` files from a zip archive into the vault."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    if len(archive) > MAX_IMPORT_ZIP_SIZE_BYTES:
        return ServiceResponse.fail("validation_failed", "Archive is too large.")

    try:
        zf = zipfile.ZipFile(io.BytesIO(archive))
    except zipfile.BadZipFile:
        return ServiceResponse.fail("validation_failed", "Not a valid zip archive.")

    imported = 0
    renamed = 0
    skipped_non_md = 0
    skipped_too_large = 0
    created_notes: list[Note] = []
    folder_cache: dict[str, UUID | None] = {"": None}

    for entry in zf.infolist():
        if entry.is_dir():
            continue
        raw_path = posixpath.normpath(entry.filename)
        # zip-slip guard + junk entries
        if raw_path.startswith(("..", "/")) or "__MACOSX" in raw_path or raw_path.endswith(".DS_Store"):
            continue
        if not raw_path.lower().endswith(".md"):
            skipped_non_md += 1
            continue
        if entry.file_size > MAX_NOTE_SIZE_BYTES:
            skipped_too_large += 1
            continue

        content = zf.read(entry).decode("utf-8", errors="replace")
        parts = [_sanitize_segment(p) for p in raw_path[:-3].split("/") if p]
        if not parts:
            continue
        title = parts[-1]
        if validate_segment(title):
            title = _sanitize_segment(title)
        folder_path = "/".join(parts[:-1])

        if folder_path not in folder_cache:
            folder_cache[folder_path] = await _ensure_folder(db, vault_id, user_id, folder_path)
        folder_id = folder_cache[folder_path]

        # Collision → Obsidian-style suffix
        attempt_title = title
        n = 0
        while True:
            candidate_path = f"{folder_path}/{attempt_title}" if folder_path else attempt_title
            exists = await db.scalar(select(Note.id).where(Note.vault_id == vault_id, Note.path == candidate_path))
            if exists is None:
                break
            n += 1
            attempt_title = f"{title} {n}"
        if n > 0:
            renamed += 1

        note = Note(
            vault_id=vault_id,
            folder_id=folder_id,
            title=attempt_title,
            path=f"{folder_path}/{attempt_title}" if folder_path else attempt_title,
        )
        err = await note_service._apply_content(note, content)
        if err:
            skipped_too_large += 1
            continue
        db.add(note)
        created_notes.append(note)
        imported += 1

    await db.flush()

    # Second pass: extract links + tags, then claim unresolved links batch-wide
    from app.services.tag_service import sync_note_tags

    for note in created_notes:
        await sync_note_links(db, note)
        await sync_note_tags(db, note)
    for note in created_notes:
        await resolve_links_for_new_note(db, note)

    await db.commit()
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))

    logger.info("vault_imported", vault_id=str(vault_id), imported=imported, renamed=renamed)
    return ServiceResponse.ok(
        {
            "imported": imported,
            "renamed": renamed,
            "skipped_non_markdown": skipped_non_md,
            "skipped_too_large": skipped_too_large,
        }
    )
