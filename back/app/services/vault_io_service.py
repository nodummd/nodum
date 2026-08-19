"""Vault import/export — plain markdown in, plain markdown out (no lock-in).

Export: zip of ``<path>.md`` files mirroring the folder tree.
Import: any zip of ``.md`` files (an Obsidian vault works as-is). Two passes:
create folders+notes first, then resolve wikilinks across the whole batch so
cross-references land regardless of zip entry order. Name collisions get an
Obsidian-style ``<name> 1`` suffix. Non-markdown entries are counted and
skipped (attachment import is a follow-up).
"""

import contextlib
import io
import posixpath
import zipfile
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.limits import MAX_ATTACHMENT_SIZE_BYTES, MAX_IMPORT_ZIP_SIZE_BYTES, MAX_NOTE_SIZE_BYTES
from app.core.logging import get_logger
from app.models.vaults import Note
from app.services import note_service
from app.services.attachment_service import ALLOWED_ATTACHMENT_TYPES
from app.services.daily_note_service import _ensure_folder
from app.services.link_service import resolve_links_for_new_note, sync_note_links
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault, invalidate_tree_cache
from app.utils.cache_utils import cache_delete, vault_graph_key
from app.utils.path_utils import validate_segment

logger = get_logger("vault_io")

# Kept in step with attachment_service.ALLOWED_ATTACHMENT_TYPES — listing a type
# here that the attachment allowlist refuses (e.g. .svg) would silently drop it.
# Derived from the upload allowlist so the two cannot drift — a type listed
# here but refused there is silently dropped mid-import, and vice versa.
_ATTACHMENT_EXTS = {f".{ext}" for ext in ALLOWED_ATTACHMENT_TYPES} - {"." + e for e in ("md", "txt")}

# Plain-text formats imported AS NOTES rather than attachments, so their content
# is searchable, linkable and editable like any other note.
_TEXT_NOTE_EXTS = {".md", ".markdown", ".txt", ".text"}


def _pdf_to_markdown(data: bytes) -> str | None:
    """Extract a PDF's text so it becomes a searchable note. None if unreadable
    (encrypted, or a pure scan with no text layer — OCR is out of scope)."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return None
        pages = []
        for page in reader.pages[:200]:  # bound the work on huge documents
            with contextlib.suppress(Exception):
                text = (page.extract_text() or "").strip()
                if text:
                    pages.append(text)
        body = "\n\n---\n\n".join(pages).strip()
        return body or None
    except Exception:
        return None


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
    db: AsyncSession, vault_id: UUID, user_id: UUID, *, archive: bytes, unwrap_root: bool = True
) -> ServiceResponse[dict[str, Any]]:
    """Import all ``.md`` files from a zip archive into the vault.

    ``unwrap_root``: a vault zipped WITH its own folder shares one root across
    every entry, and that wrapper is stripped (see below). Callers that built
    the archive themselves from explicit paths — the MCP import — pass False,
    or a batch that happens to live in one folder would lose the folder.
    """
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    if len(archive) > MAX_IMPORT_ZIP_SIZE_BYTES:
        return ServiceResponse.fail("validation_failed", "Archive is too large.")

    try:
        zf = zipfile.ZipFile(io.BytesIO(archive))
    except zipfile.BadZipFile:
        return ServiceResponse.fail("validation_failed", "Not a valid zip archive.")

    # A vault is normally zipped WITH its own folder ("MyVault/Notes/x.md").
    # Recreating that wrapper would nest the whole vault one level deep and
    # break every path-style wikilink ([[Projects/Alpha]] would no longer match
    # "MyVault/Projects/Alpha"), so strip a root that every entry shares.
    def _archive_root(names: list[str]) -> str:
        roots = set()
        for n in names:
            n = posixpath.normpath(n)
            if n.startswith(("..", "/")) or "__MACOSX" in n or n.endswith(".DS_Store"):
                continue
            head = n.split("/", 1)
            if len(head) == 1:
                return ""  # a file sits at the archive root — nothing to strip
            roots.add(head[0])
            if len(roots) > 1:
                return ""
        return roots.pop() if len(roots) == 1 else ""

    root_prefix = _archive_root([e.filename for e in zf.infolist() if not e.is_dir()]) if unwrap_root else ""

    imported = 0
    renamed = 0
    imported_attachments = 0
    obsidian_configs: dict[str, Any] = {}
    attachment_entries: list[tuple[str, zipfile.ZipInfo]] = []
    pdf_entries: list[tuple[str, zipfile.ZipInfo, str]] = []
    imported_pdf_notes = 0
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
        if root_prefix and raw_path.startswith(f"{root_prefix}/"):
            raw_path = raw_path[len(root_prefix) + 1 :]
            if not raw_path:
                continue
        ext_lower = posixpath.splitext(raw_path)[1].lower()
        if ext_lower not in _TEXT_NOTE_EXTS:
            lower = raw_path.lower()
            base = posixpath.basename(raw_path)
            # Vaults are normally zipped WITH their top folder, so match the
            # ".obsidian/…" suffix rather than the whole path — otherwise a
            # real Obsidian export never has its config detected.
            in_obsidian_dir = "/.obsidian/" in f"/{lower}"
            if in_obsidian_dir and base in ("daily-notes.json", "app.json"):
                import json as _json

                with contextlib.suppress(Exception):
                    obsidian_configs[base] = _json.loads(zf.read(entry).decode("utf-8", errors="replace"))
                continue
            if in_obsidian_dir:
                continue
            ext = posixpath.splitext(base)[1].lower()
            if ext in _ATTACHMENT_EXTS and entry.file_size <= MAX_ATTACHMENT_SIZE_BYTES:
                attachment_entries.append((base, entry))
                # A PDF also becomes a note holding its extracted text, so the
                # document is searchable and linkable rather than just a blob.
                if ext == ".pdf":
                    pdf_entries.append((base, entry, posixpath.dirname(raw_path)))
                continue
            skipped_non_md += 1
            continue
        if entry.file_size > MAX_NOTE_SIZE_BYTES:
            skipped_too_large += 1
            continue

        content = zf.read(entry).decode("utf-8", errors="replace")
        stem = raw_path[: -len(ext_lower)] if ext_lower else raw_path
        parts = [_sanitize_segment(p) for p in stem.split("/") if p]
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

    # Binary files → attachments (best-effort per file)
    import mimetypes

    from app.services import attachment_service

    stored_names: dict[str, str] = {}
    for base, entry in attachment_entries:
        # Best-effort per file: one unreadable image must not abort the import.
        # But it is LOGGED — a silent skip reports "0 attachments" with no way
        # to tell a vault that had none from one whose uploads all failed.
        try:
            result = await attachment_service.upload(
                db,
                vault_id,
                user_id,
                filename=base,
                content=zf.read(entry),
                mime_type=mimetypes.guess_type(base)[0] or "application/octet-stream",
            )
        except Exception as e:
            logger.warning("import_attachment_failed", file=base, error=repr(e))
            continue
        if result.success and result.data is not None:
            imported_attachments += 1
            # Uploads may be renamed on collision — remember the stored name
            # so the PDF note embeds the file that actually exists.
            stored_names[base] = result.data.filename
        else:
            logger.warning("import_attachment_rejected", file=base, error=result.message)

    # PDFs → notes holding their extracted text plus an embed of the original.
    # Done after upload so the embed points at the stored filename.
    pdf_notes: list[Note] = []
    for base, entry, parent_dir in pdf_entries:
        stored = stored_names.get(base)
        if stored is None:
            continue  # upload was refused; nothing to embed
        text = _pdf_to_markdown(zf.read(entry))
        if text is None:
            continue  # encrypted or scanned with no text layer
        title = _sanitize_segment(posixpath.splitext(base)[0])
        folder_path = "/".join(_sanitize_segment(p) for p in parent_dir.split("/") if p)
        if folder_path not in folder_cache:
            folder_cache[folder_path] = await _ensure_folder(db, vault_id, user_id, folder_path)
        attempt_title = title
        n = 0
        while True:
            candidate = f"{folder_path}/{attempt_title}" if folder_path else attempt_title
            if await db.scalar(select(Note.id).where(Note.vault_id == vault_id, Note.path == candidate)) is None:
                break
            n += 1
            attempt_title = f"{title} {n}"
        note = Note(
            vault_id=vault_id,
            folder_id=folder_cache[folder_path],
            title=attempt_title,
            path=f"{folder_path}/{attempt_title}" if folder_path else attempt_title,
        )
        if await note_service._apply_content(note, f"![[{stored}]]\n\n{text}"):
            continue
        db.add(note)
        pdf_notes.append(note)
        imported_pdf_notes += 1

    if pdf_notes:
        await db.flush()
        for note in pdf_notes:
            await sync_note_links(db, note)
            await sync_note_tags(db, note)
            await resolve_links_for_new_note(db, note)
        await db.commit()

    # .obsidian config → vault settings (daily notes + templates basics)
    settings_mapped = False
    daily = obsidian_configs.get("daily-notes.json") or {}
    app_cfg = obsidian_configs.get("app.json") or {}
    patch: dict[str, Any] = {}
    if isinstance(daily.get("format"), str) and daily["format"]:
        patch["dailyNoteFormat"] = daily["format"]
    if isinstance(daily.get("folder"), str) and daily["folder"]:
        patch["dailyNoteFolder"] = daily["folder"]
    if isinstance(daily.get("template"), str) and daily["template"]:
        patch["dailyNoteTemplate"] = daily["template"]
    if isinstance(app_cfg.get("attachmentFolderPath"), str):
        pass  # attachments are flat in nodum; path mapping not needed
    if patch:
        from app.services.vault_service import update_vault_settings

        result = await update_vault_settings(db, vault_id, user_id, settings_patch=patch)
        settings_mapped = result.success

    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))

    logger.info(
        "vault_imported",
        vault_id=str(vault_id),
        imported=imported,
        renamed=renamed,
        attachments=imported_attachments,
    )
    return ServiceResponse.ok(
        {
            "imported": imported,
            "renamed": renamed,
            "imported_attachments": imported_attachments,
            "imported_pdf_notes": imported_pdf_notes,
            "settings_mapped": settings_mapped,
            "skipped_non_markdown": skipped_non_md,
            "skipped_too_large": skipped_too_large,
        }
    )
