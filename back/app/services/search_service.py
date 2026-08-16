"""Search service — full-text search with operators, and the quick switcher.

Operator syntax (subset of Obsidian's):
    path:foo      — path contains foo (case-insensitive)
    file:foo      — title contains foo
    tag:foo       — note has tag foo (nested prefix matching)
    created:RANGE / updated:RANGE — date filters. RANGE forms:
        2026-08-01              that calendar day
        2026-08-01..2026-08-12  inclusive range
        >2026-08-01  <2026-08-12  open-ended bounds
    "quoted"      — phrase (passed to websearch_to_tsquery)
    -term         — exclusion (websearch_to_tsquery handles it)
Remaining words form the websearch query.
"""

import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tags import NoteTag, Tag
from app.models.vaults import Note, NoteAlias
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault

_OPERATOR_RE = re.compile(r'(?P<op>path|file|tag|created|updated):(?P<val>"[^"]+"|\S+)')


def parse_query(q: str) -> tuple[str, dict[str, list[str]]]:
    """Split a raw query into (text_query, {operator: [values]})."""
    operators: dict[str, list[str]] = {}

    def _capture(match: re.Match[str]) -> str:
        value = match.group("val").strip('"')
        operators.setdefault(match.group("op"), []).append(value)
        return " "

    text = _OPERATOR_RE.sub(_capture, q).strip()
    return text, operators


def _parse_date_range(raw: str) -> tuple[datetime | None, datetime | None]:
    """Parse a created:/updated: value into (from, to) bounds (inclusive day)."""

    def day(value: str) -> datetime | None:
        try:
            return datetime.strptime(value.strip(), "%Y-%m-%d")
        except ValueError:
            return None

    raw = raw.strip()
    if ".." in raw:
        start_s, end_s = raw.split("..", 1)
        start, end = day(start_s), day(end_s)
        return start, (end + timedelta(days=1)) if end else None
    if raw.startswith(">"):
        return day(raw[1:].lstrip("=")), None
    if raw.startswith("<"):
        end = day(raw[1:].lstrip("="))
        return None, (end + timedelta(days=1)) if end else None
    single = day(raw)
    if single:
        return single, single + timedelta(days=1)
    return None, None


def _apply_operators(stmt: Select, operators: dict[str, list[str]], vault_id: UUID) -> Select:
    for value in operators.get("path", []):
        stmt = stmt.where(Note.path.icontains(value, autoescape=True))
    for value in operators.get("file", []):
        stmt = stmt.where(Note.title.icontains(value, autoescape=True))
    for value in operators.get("tag", []):
        tag = value.lstrip("#").lower()
        tag_notes = (
            select(NoteTag.note_id)
            .join(Tag, Tag.id == NoteTag.tag_id)
            .where(Tag.vault_id == vault_id, or_(Tag.name == tag, Tag.name.startswith(f"{tag}/", autoescape=True)))
        )
        stmt = stmt.where(Note.id.in_(tag_notes))
    for op_name, column in (("created", Note.created_at), ("updated", Note.updated_at)):
        for value in operators.get(op_name, []):
            date_from, date_to = _parse_date_range(value)
            if date_from:
                stmt = stmt.where(column >= date_from)
            if date_to:
                stmt = stmt.where(column < date_to)
    return stmt


async def search_notes(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    *,
    q: str,
    sort: str = "relevance",
    limit: int = 20,
    offset: int = 0,
) -> ServiceResponse[dict[str, Any]]:
    """Ranked full-text search with highlighted snippets.

    ``sort``: relevance (default; falls back to updated when no text query),
    updated, created, title.
    """
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    text, operators = parse_query(q)
    if not text and not operators:
        return ServiceResponse.ok({"query": q, "results": [], "total": 0})

    base = select(Note.id, Note.title, Note.path, Note.folder_id, Note.created_at, Note.updated_at).where(
        Note.vault_id == vault_id
    )
    base = _apply_operators(base, operators, vault_id)

    order_map = {
        "updated": (Note.updated_at.desc(),),
        "created": (Note.created_at.desc(),),
        "title": (Note.title.asc(),),
    }

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
        ordering = order_map.get(sort, (rank.desc(), Note.updated_at.desc()))
        stmt = base.add_columns(rank.label("rank"), headline.label("snippet")).order_by(*ordering)
    else:
        ordering = order_map.get(sort, (Note.updated_at.desc(),))
        stmt = base.add_columns(
            literal(0.0).label("rank"),
            func.left(Note.content, 200).label("snippet"),
        ).order_by(*ordering)

    # Window count gives the true total for pagination without a second query.
    stmt = stmt.add_columns(func.count().over().label("total_count"))
    rows = (await db.execute(stmt.limit(limit).offset(offset))).all()

    results = [
        {
            "id": str(row.id),
            "title": row.title,
            "path": row.path,
            "snippet": row.snippet,
            "rank": float(row.rank or 0),
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }
        for row in rows
    ]
    total = int(rows[0].total_count) if rows else 0
    return ServiceResponse.ok({"query": q, "results": results, "total": total})


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
                or_(
                    Note.title.icontains(q, autoescape=True), Note.path.icontains(q, autoescape=True), similarity > 0.15
                ),
            )
            .order_by(Note.title.istartswith(q, autoescape=True).desc(), similarity.desc(), Note.updated_at.desc())
            .limit(limit)
        )
    ).all()
    results = [{"id": str(i), "title": t, "path": p, "score": float(s or 0)} for i, t, p, s in rows]

    # Frontmatter aliases match too — labeled so the UI can show "alias of X".
    # Title matches win when the same note appears through both routes.
    alias_similarity = func.similarity(NoteAlias.alias, q)
    alias_rows = (
        await db.execute(
            select(Note.id, Note.title, Note.path, NoteAlias.alias, alias_similarity.label("score"))
            .join(Note, Note.id == NoteAlias.note_id)
            .where(
                NoteAlias.vault_id == vault_id,
                or_(NoteAlias.alias.icontains(q, autoescape=True), alias_similarity > 0.15),
            )
            .order_by(NoteAlias.alias.istartswith(q, autoescape=True).desc(), alias_similarity.desc())
            .limit(limit)
        )
    ).all()
    seen_ids = {r["id"] for r in results}
    for i, t, p, alias, s in alias_rows:
        if str(i) not in seen_ids:
            seen_ids.add(str(i))
            results.append({"id": str(i), "title": t, "path": p, "score": float(s or 0), "alias": alias})
    return ServiceResponse.ok(results[:limit])
