"""Tag service — sync on note save, tag pane, notes-by-tag."""

from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tags import NoteTag, Tag
from app.models.vaults import Note
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault
from app.utils.markdown_parse import extract_tags, frontmatter_tags


async def sync_note_tags(db: AsyncSession, note: Note) -> None:
    """Recompute the note's tag set (inline #tags ∪ frontmatter tags). Caller commits."""
    wanted = extract_tags(note.content) | frontmatter_tags(note.properties or {})

    await db.execute(delete(NoteTag).where(NoteTag.note_id == note.id))
    if not wanted:
        return

    existing = {
        t.name: t.id
        for t in (await db.execute(select(Tag).where(Tag.vault_id == note.vault_id, Tag.name.in_(wanted)))).scalars()
    }
    for name in wanted:
        tag_id = existing.get(name)
        if tag_id is None:
            tag = Tag(vault_id=note.vault_id, name=name)
            db.add(tag)
            await db.flush()
            tag_id = tag.id
        db.add(NoteTag(note_id=note.id, tag_id=tag_id))


async def list_tags(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[list[dict[str, Any]]]:
    """All tags in a vault with usage counts (unused tags are pruned lazily)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    rows = (
        await db.execute(
            select(Tag.name, func.count(NoteTag.note_id).label("count"))
            .outerjoin(NoteTag, NoteTag.tag_id == Tag.id)
            .where(Tag.vault_id == vault_id)
            .group_by(Tag.name)
            .having(func.count(NoteTag.note_id) > 0)
            .order_by(func.count(NoteTag.note_id).desc(), Tag.name)
        )
    ).all()
    return ServiceResponse.ok([{"name": name, "count": count} for name, count in rows])


async def notes_by_tag(
    db: AsyncSession, vault_id: UUID, user_id: UUID, tag_name: str
) -> ServiceResponse[list[dict[str, Any]]]:
    """Notes carrying a tag; nested tags match by prefix (#a matches #a/b)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    tag_name = tag_name.strip().lstrip("#").lower()
    rows = (
        await db.execute(
            select(Note.id, Note.title, Note.path)
            .join(NoteTag, NoteTag.note_id == Note.id)
            .join(Tag, Tag.id == NoteTag.tag_id)
            .where(
                Tag.vault_id == vault_id,
                or_(Tag.name == tag_name, Tag.name.like(f"{tag_name}/%")),
            )
            .distinct()
            .order_by(Note.title)
        )
    ).all()
    return ServiceResponse.ok([{"id": str(i), "title": t, "path": p} for i, t, p in rows])
