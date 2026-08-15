"""Note service — CRUD with optimistic concurrency and frontmatter parsing."""

from datetime import datetime
from typing import Any
from uuid import UUID

import frontmatter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.limits import MAX_NOTE_SIZE_BYTES, MAX_NOTES_PER_VAULT
from app.core.logging import get_logger
from app.models.vaults import Folder, Note
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault, invalidate_tree_cache
from app.utils.cache_utils import cache_delete, vault_graph_key
from app.utils.path_utils import count_words, join_path, validate_depth, validate_segment

logger = get_logger("notes")


def parse_properties(content: str) -> dict[str, Any]:
    """Parse YAML frontmatter into a JSONB-safe dict; {} when absent/invalid."""
    try:
        post = frontmatter.loads(content)
    except Exception:
        return {}
    props = dict(post.metadata) if isinstance(post.metadata, dict) else {}

    def _safe(v: Any) -> Any:
        if isinstance(v, dict):
            return {str(k): _safe(x) for k, x in v.items()}
        if isinstance(v, list):
            return [_safe(x) for x in v]
        if isinstance(v, (str, int, float, bool)) or v is None:
            return v
        return str(v)  # dates and other YAML scalars

    return {str(k): _safe(v) for k, v in props.items()}


async def _note_in_vault(db: AsyncSession, note_id: UUID, vault_id: UUID) -> Note | None:
    return await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id))


async def _note_path_taken(db: AsyncSession, vault_id: UUID, path: str, *, exclude_id: UUID | None = None) -> bool:
    q = select(Note.id).where(Note.vault_id == vault_id, Note.path == path)
    if exclude_id:
        q = q.where(Note.id != exclude_id)
    return (await db.scalar(q)) is not None


async def _apply_content(note: Note, content: str) -> str | None:
    """Set content-derived fields. Returns an error message or None."""
    if len(content.encode()) > MAX_NOTE_SIZE_BYTES:
        return "Note is too large."
    note.content = content
    note.word_count = count_words(content)
    note.properties = parse_properties(content)

    from app.services.embedding_service import embed_text

    note.embedding = await embed_text(f"{note.title}\n{content}")
    return None


async def create_note(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    *,
    title: str,
    folder_id: UUID | None = None,
    content: str = "",
) -> ServiceResponse[Note]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    title = title.strip()
    if err := validate_segment(title):
        return ServiceResponse.fail("validation_failed", err)

    from sqlalchemy import func

    note_count = await db.scalar(select(func.count()).select_from(Note).where(Note.vault_id == vault_id))
    if note_count is not None and note_count >= MAX_NOTES_PER_VAULT:
        return ServiceResponse.fail("validation_failed", "Vault note limit reached.")

    folder_path: str | None = None
    if folder_id is not None:
        folder = await db.scalar(select(Folder).where(Folder.id == folder_id, Folder.vault_id == vault_id))
        if folder is None:
            return ServiceResponse.fail("not_found", "Folder not found.")
        folder_path = folder.path

    path = join_path(folder_path, title)
    if err := validate_depth(path):
        return ServiceResponse.fail("validation_failed", err)
    if await _note_path_taken(db, vault_id, path):
        return ServiceResponse.fail("already_exists", "A note with this path already exists.")

    note = Note(vault_id=vault_id, folder_id=folder_id, title=title, path=path)
    if err := await _apply_content(note, content):
        return ServiceResponse.fail("validation_failed", err)

    db.add(note)
    await db.flush()

    from app.services.link_service import resolve_links_for_new_note, sync_note_aliases, sync_note_links
    from app.services.tag_service import sync_note_tags

    await sync_note_links(db, note)
    await sync_note_tags(db, note)
    await sync_note_aliases(db, note)
    await resolve_links_for_new_note(db, note)
    await db.commit()
    await db.refresh(note)
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(note)


async def get_note(db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID) -> ServiceResponse[Note]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await _note_in_vault(db, note_id, vault_id)
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    return ServiceResponse.ok(note)


async def get_note_by_path(db: AsyncSession, vault_id: UUID, user_id: UUID, path: str) -> ServiceResponse[Note]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note).where(Note.vault_id == vault_id, Note.path == path))
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    return ServiceResponse.ok(note)


async def update_content(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    note_id: UUID,
    *,
    content: str,
    base_updated_at: datetime | None = None,
) -> ServiceResponse[Note]:
    """Save note content.

    Optimistic concurrency: when the client supplies ``base_updated_at`` and it
    no longer matches the row, the save is rejected with 409 so the client can
    merge instead of silently overwriting a newer version (e.g. second tab).
    The row is locked (FOR UPDATE) so the check-then-write is atomic under
    concurrent saves from multiple workers.
    """
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id).with_for_update())
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")

    if base_updated_at is not None and note.updated_at != base_updated_at:
        return ServiceResponse.fail(
            "conflict",
            "Note was modified elsewhere.",
            server_updated_at=note.updated_at.isoformat(),
        )

    from app.services.version_service import maybe_snapshot

    await maybe_snapshot(db, note, content)

    if err := await _apply_content(note, content):
        return ServiceResponse.fail("validation_failed", err)

    from app.services.link_service import sync_note_aliases, sync_note_links
    from app.services.tag_service import sync_note_tags

    await sync_note_links(db, note)
    await sync_note_tags(db, note)
    await sync_note_aliases(db, note)
    await db.commit()
    await db.refresh(note)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(note)


async def set_tags(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    note_id: UUID,
    *,
    add: list[str] | None = None,
    remove: list[str] | None = None,
) -> ServiceResponse[Note]:
    """Add/remove tags via YAML frontmatter, leaving the body untouched.

    Assigning a tag from the file explorer must not edit prose, so tags go in
    the ``tags`` frontmatter list — which ``frontmatter_tags`` already unions
    with inline ``#tags`` when the note is synced. Inline tags in the body are
    intentionally left alone: they belong to the sentence they sit in.
    """
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await _note_in_vault(db, note_id, vault_id)
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")

    def _clean(tags: list[str] | None) -> list[str]:
        out = []
        for t in tags or []:
            t = t.strip().lstrip("#").strip("/").lower()
            if t and t not in out:
                out.append(t)
        return out

    additions, removals = _clean(add), set(_clean(remove))

    post = frontmatter.loads(note.content)
    raw = post.metadata.get("tags")
    current = [raw] if isinstance(raw, str) else [str(t) for t in raw] if isinstance(raw, list) else []
    merged = [t for t in (_clean(current) + additions) if t not in removals]
    # dedupe, preserving order
    seen: set[str] = set()
    merged = [t for t in merged if not (t in seen or seen.add(t))]

    if merged:
        post.metadata["tags"] = merged
    else:
        post.metadata.pop("tags", None)
    # frontmatter.dumps re-emits the body verbatim; with no metadata left it
    # returns the bare body (no empty --- block).
    content = frontmatter.dumps(post) if post.metadata else post.content

    return await update_content(db, vault_id, user_id, note_id, content=content)


async def rename_note(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    note_id: UUID,
    *,
    title: str | None = None,
    folder_id: UUID | None = None,
    move_to_root: bool = False,
) -> ServiceResponse[Note]:
    """Rename and/or move a note (recomputes path)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await _note_in_vault(db, note_id, vault_id)
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")

    new_title = note.title
    if title is not None:
        new_title = title.strip()
        if err := validate_segment(new_title):
            return ServiceResponse.fail("validation_failed", err)

    new_folder_id = note.folder_id
    folder_path: str | None = None
    if move_to_root:
        new_folder_id = None
    elif folder_id is not None:
        folder = await db.scalar(select(Folder).where(Folder.id == folder_id, Folder.vault_id == vault_id))
        if folder is None:
            return ServiceResponse.fail("not_found", "Target folder not found.")
        new_folder_id = folder.id
        folder_path = folder.path
    elif note.folder_id is not None:
        current = await db.scalar(select(Folder).where(Folder.id == note.folder_id))
        folder_path = current.path if current else None

    new_path = join_path(folder_path, new_title)
    if err := validate_depth(new_path):
        return ServiceResponse.fail("validation_failed", err)
    if new_path != note.path and await _note_path_taken(db, vault_id, new_path, exclude_id=note_id):
        return ServiceResponse.fail("already_exists", "A note with this path already exists.")

    old_title, old_path = note.title, note.path
    note.title = new_title
    note.folder_id = new_folder_id
    note.path = new_path

    from app.services.link_service import resolve_links_for_new_note, unresolve_links_for_renamed_note

    await unresolve_links_for_renamed_note(db, note, old_title, old_path)
    await resolve_links_for_new_note(db, note)
    await db.commit()
    await db.refresh(note)
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(note)


async def delete_note(db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID) -> ServiceResponse[None]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await _note_in_vault(db, note_id, vault_id)
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    await db.delete(note)
    await db.commit()
    await invalidate_tree_cache(vault_id)
    await cache_delete(vault_graph_key(vault_id))
    return ServiceResponse.ok(None)
