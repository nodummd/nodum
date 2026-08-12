"""Search service — full-text search with operators, and the quick switcher.

Operator syntax (subset of Obsidian's):
    path:foo      — path contains foo (case-insensitive)
    file:foo      — title contains foo
    tag:foo       — note has tag foo (nested prefix matching)
    "quoted"      — phrase (passed to websearch_to_tsquery)
    -term         — exclusion (websearch_to_tsquery handles it)
Remaining words form the websearch query.
"""

import re
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tags import NoteTag, Tag
from app.models.vaults import Note
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault

_OPERATOR_RE = re.compile(r'(?P<op>path|file|tag):(?P<val>"[^"]+"|\S+)')


def parse_query(q: str) -> tuple[str, dict[str, list[str]]]:
    """Split a raw query into (text_query, {operator: [values]})."""
    operators: dict[str, list[str]] = {}

    def _capture(match: re.Match[str]) -> str:
        value = match.group("val").strip('"')
        operators.setdefault(match.group("op"), []).append(value)
        return " "

    text = _OPERATOR_RE.sub(_capture, q).strip()
    return text, operators


def _apply_operators(stmt: Select, operators: dict[str, list[str]], vault_id: UUID) -> Select:
    for value in operators.get("path", []):
        stmt = stmt.where(Note.path.ilike(f"%{value}%"))
    for value in operators.get("file", []):
        stmt = stmt.where(Note.title.ilike(f"%{value}%"))
    for value in operators.get("tag", []):
        tag = value.lstrip("#").lower()
        tag_notes = (
            select(NoteTag.note_id)
            .join(Tag, Tag.id == NoteTag.tag_id)
            .where(Tag.vault_id == vault_id, or_(Tag.name == tag, Tag.name.like(f"{tag}/%")))
        )
        stmt = stmt.where(Note.id.in_(tag_notes))
    return stmt


async def search_notes(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    *,
    q: str,
    limit: int = 20,
    offset: int = 0,
) -> ServiceResponse[dict[str, Any]]:
    """Ranked full-text search with highlighted snippets."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    text, operators = parse_query(q)
    if not text and not operators:
        return ServiceResponse.ok({"query": q, "results": [], "total": 0})

    base = select(Note.id, Note.title, Note.path, Note.folder_id, Note.updated_at).where(Note.vault_id == vault_id)
    base = _apply_operators(base, operators, vault_id)

    if text:
        tsquery = func.websearch_to_tsquery("english", text)
        base = base.where(Note.content_tsv.op("@@")(tsquery))
        rank = func.ts_rank_cd(Note.content_tsv, tsquery)
        headline = func.ts_headline(
            "english",
            Note.content,
            tsquery,
            "StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=2",
        )
        stmt = base.add_columns(rank.label("rank"), headline.label("snippet")).order_by(
            rank.desc(), Note.updated_at.desc()
        )
    else:
        stmt = base.add_columns(
            literal(0.0).label("rank"),
            func.left(Note.content, 200).label("snippet"),
        ).order_by(Note.updated_at.desc())

    rows = (await db.execute(stmt.limit(limit).offset(offset))).all()

    results = [
        {
            "id": str(row.id),
            "title": row.title,
            "path": row.path,
            "snippet": row.snippet,
            "rank": float(row.rank or 0),
            "updated_at": row.updated_at.isoformat(),
        }
        for row in rows
    ]
    return ServiceResponse.ok({"query": q, "results": results, "total": len(results)})


async def quick_switch(
    db: AsyncSession, vault_id: UUID, user_id: UUID, *, q: str, limit: int = 10
) -> ServiceResponse[list[dict[str, Any]]]:
    """Fuzzy note-title matching for the Cmd+O switcher (trigram + prefix)."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    q = q.strip()
    if not q:
        # Empty query → most recently updated notes (Obsidian shows recents)
        rows = (
            await db.execute(
                select(Note.id, Note.title, Note.path)
                .where(Note.vault_id == vault_id)
                .order_by(Note.updated_at.desc())
                .limit(limit)
            )
        ).all()
        return ServiceResponse.ok([{"id": str(i), "title": t, "path": p, "score": 0.0} for i, t, p in rows])

    similarity = func.similarity(Note.title, q)
    rows = (
        await db.execute(
            select(Note.id, Note.title, Note.path, similarity.label("score"))
            .where(
                Note.vault_id == vault_id,
                or_(Note.title.ilike(f"%{q}%"), Note.path.ilike(f"%{q}%"), similarity > 0.15),
            )
            .order_by(Note.title.ilike(f"{q}%").desc(), similarity.desc(), Note.updated_at.desc())
            .limit(limit)
        )
    ).all()
    return ServiceResponse.ok([{"id": str(i), "title": t, "path": p, "score": float(s or 0)} for i, t, p, s in rows])
