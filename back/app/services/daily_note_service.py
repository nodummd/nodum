"""Daily notes & templates — Obsidian's core capture workflow.

Vault settings keys (all optional):
    dailyNoteFormat   date format, moment-style tokens (default "YYYY-MM-DD")
    dailyNoteFolder   folder path for daily notes (default "" = vault root)
    dailyNoteTemplate note path used as template for new daily notes
    templatesFolder   folder containing template notes (default "Templates")

Template variables: {{date}}, {{time}}, {{title}}, {{date:FORMAT}}.
"""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vaults import Folder, Note
from app.services import folder_service, note_service
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault

_TOKEN_MAP = [
    ("YYYY", "%Y"),
    ("YY", "%y"),
    ("MMMM", "%B"),
    ("MMM", "%b"),
    ("MM", "%m"),
    ("DD", "%d"),
    ("dddd", "%A"),
    ("ddd", "%a"),
    ("HH", "%H"),
    ("mm", "%M"),
    ("ss", "%S"),
]


def format_date(fmt: str, when: datetime) -> str:
    """Render a moment-style date format (token subset) via strftime."""
    out = fmt
    for token, strf in _TOKEN_MAP:
        out = out.replace(token, when.strftime(strf))
    return out


def apply_template_vars(content: str, *, title: str, when: datetime) -> str:
    """Substitute {{date}}, {{time}}, {{title}} and {{date:FORMAT}}."""
    content = content.replace("{{title}}", title)
    content = content.replace("{{date}}", when.strftime("%Y-%m-%d"))
    content = content.replace("{{time}}", when.strftime("%H:%M"))
    return re.sub(r"\{\{date:([^}]+)\}\}", lambda m: format_date(m.group(1), when), content)


async def _ensure_folder(db: AsyncSession, vault_id: UUID, user_id: UUID, path: str) -> UUID | None:
    """Get or create the (possibly nested) folder for a path; None = root."""
    if not path:
        return None
    parent_id: UUID | None = None
    walked = ""
    for segment in path.split("/"):
        walked = f"{walked}/{segment}" if walked else segment
        existing = await db.scalar(select(Folder).where(Folder.vault_id == vault_id, Folder.path == walked))
        if existing:
            parent_id = existing.id
            continue
        created = await folder_service.create_folder(db, vault_id, user_id, name=segment, parent_id=parent_id)
        if not created.success or created.data is None:
            return parent_id
        parent_id = created.data.id
    return parent_id


async def open_daily_note(
    db: AsyncSession, vault_id: UUID, user_id: UUID, *, now: datetime | None = None
) -> ServiceResponse[Note]:
    """Return today's daily note, creating it (from the template) if missing."""
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    when = now or datetime.now()
    settings: dict[str, Any] = vault.settings or {}
    fmt = str(settings.get("dailyNoteFormat") or "YYYY-MM-DD")
    folder_path = str(settings.get("dailyNoteFolder") or "").strip().strip("/")
    title = format_date(fmt, when)
    full_path = f"{folder_path}/{title}" if folder_path else title

    existing = await db.scalar(select(Note).where(Note.vault_id == vault_id, Note.path == full_path))
    if existing:
        return ServiceResponse.ok(existing)

    content = ""
    template_path = str(settings.get("dailyNoteTemplate") or "").strip()
    if template_path:
        template = await db.scalar(select(Note).where(Note.vault_id == vault_id, Note.path == template_path))
        if template:
            content = apply_template_vars(template.content, title=title, when=when)

    folder_id = await _ensure_folder(db, vault_id, user_id, folder_path)
    return await note_service.create_note(db, vault_id, user_id, title=title, folder_id=folder_id, content=content)


async def list_templates(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[list[dict[str, str]]]:
    """Notes inside the templates folder (default 'Templates')."""
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    folder = str((vault.settings or {}).get("templatesFolder") or "Templates").strip().strip("/")
    rows = (
        await db.execute(
            select(Note.id, Note.title, Note.path)
            .where(Note.vault_id == vault_id, Note.path.startswith(f"{folder}/", autoescape=True))
            .order_by(Note.title)
        )
    ).all()
    return ServiceResponse.ok([{"id": str(i), "title": t, "path": p} for i, t, p in rows])


async def insert_template(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    note_id: UUID,
    template_id: UUID,
    *,
    now: datetime | None = None,
) -> ServiceResponse[Note]:
    """Append the template's content (with vars) to a note; replaces when empty."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id))
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")
    template = await db.scalar(select(Note).where(Note.id == template_id, Note.vault_id == vault_id))
    if template is None:
        return ServiceResponse.fail("not_found", "Template not found.")

    when = now or datetime.now()
    rendered = apply_template_vars(template.content, title=note.title, when=when)
    new_content = rendered if not note.content.strip() else f"{note.content.rstrip()}\n\n{rendered}"
    return await note_service.update_content(db, vault_id, user_id, note_id, content=new_content)
