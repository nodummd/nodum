"""Link service — extraction sync, resolution, backlinks, knowledge graph."""

from collections import Counter
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.links import Link
from app.models.vaults import Note, NoteAlias
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault
from app.settings import get_settings
from app.utils.cache_utils import cache_get_json, cache_set_json, vault_graph_key
from app.utils.markdown_parse import extract_wikilinks

logger = get_logger("links")


def _normalize_target(target: str) -> str:
    return target.strip().lower()


async def _resolve_targets(db: AsyncSession, vault_id: UUID, targets: set[str]) -> dict[str, UUID]:
    """Map normalized target strings → note ids (title match first, then path)."""
    if not targets:
        return {}
    rows = (
        await db.execute(
            select(Note.id, Note.title, Note.path).where(
                Note.vault_id == vault_id,
                or_(func.lower(Note.title).in_(targets), func.lower(Note.path).in_(targets)),
            )
        )
    ).all()
    resolved: dict[str, UUID] = {}
    # Path matches are exact; title matches may collide across folders — the
    # first (arbitrary but stable) match wins, mirroring shortest-path intent.
    for row in rows:
        path_key = row.path.lower()
        if path_key in targets:
            resolved[path_key] = row.id
    for row in rows:
        title_key = row.title.lower()
        if title_key in targets and title_key not in resolved:
            resolved[title_key] = row.id

    # Anything still unresolved may be a frontmatter alias. Oldest row wins
    # when two notes claim the same alias (uuid7 ids are time-ordered).
    unresolved = targets - resolved.keys()
    if unresolved:
        alias_rows = (
            await db.execute(
                select(NoteAlias.note_id, func.lower(NoteAlias.alias).label("key"))
                .where(NoteAlias.vault_id == vault_id, func.lower(NoteAlias.alias).in_(unresolved))
                .order_by(NoteAlias.id)
            )
        ).all()
        for arow in alias_rows:
            resolved.setdefault(arow.key, arow.note_id)
    return resolved


async def sync_note_links(db: AsyncSession, note: Note) -> None:
    """Re-extract and persist links for a note. Caller commits.

    Called from note create/update flows. One DELETE + bulk INSERT keeps the
    edge set exact; resolution happens in the same transaction.
    """
    wikilinks = extract_wikilinks(note.content)

    await db.execute(delete(Link).where(Link.source_note_id == note.id))
    if not wikilinks:
        return

    counted: Counter[tuple[str, bool]] = Counter()
    for wl in wikilinks:
        counted[(_normalize_target(wl.target), wl.is_embed)] += 1

    targets = {t for (t, _e) in counted}
    resolved = await _resolve_targets(db, note.vault_id, targets)

    for (target, is_embed), n in counted.items():
        target_id = resolved.get(target)
        if target_id == note.id and len(counted) == 1:
            pass  # self-link is allowed; graph just shows a loop edge
        db.add(
            Link(
                vault_id=note.vault_id,
                source_note_id=note.id,
                target_note_id=target_id,
                target_title=target,
                is_embed=is_embed,
                count=n,
            )
        )


async def sync_note_aliases(db: AsyncSession, note: Note) -> None:
    """Recompute the note's alias rows from frontmatter. Caller commits.

    Newly added aliases claim matching unresolved links vault-wide; removed
    aliases release links that were resolved through them (links written
    against the note's title/path are left alone).
    """
    from sqlalchemy import update

    from app.utils.markdown_parse import frontmatter_aliases

    wanted = frontmatter_aliases(note.properties or {})
    wanted_lower = {a.lower() for a in wanted}
    existing = {
        a.lower() for a in (await db.scalars(select(NoteAlias.alias).where(NoteAlias.note_id == note.id))).all()
    }
    if wanted_lower == existing:
        return

    await db.execute(delete(NoteAlias).where(NoteAlias.note_id == note.id))
    for alias in wanted:
        db.add(NoteAlias(vault_id=note.vault_id, note_id=note.id, alias=alias))

    added = wanted_lower - existing
    if added:
        await db.execute(
            update(Link)
            .where(
                Link.vault_id == note.vault_id,
                Link.target_note_id.is_(None),
                Link.target_title.in_(added),
            )
            .values(target_note_id=note.id)
        )
    removed = (existing - wanted_lower) - {note.title.lower(), note.path.lower()}
    if removed:
        await db.execute(
            update(Link)
            .where(
                Link.vault_id == note.vault_id,
                Link.target_note_id == note.id,
                Link.target_title.in_(removed),
            )
            .values(target_note_id=None)
        )


async def resolve_links_for_new_note(db: AsyncSession, note: Note) -> None:
    """When a note is created/renamed, claim unresolved links matching it. Caller commits."""
    from sqlalchemy import update

    for key in {note.title.lower(), note.path.lower()}:
        await db.execute(
            update(Link)
            .where(
                Link.vault_id == note.vault_id,
                Link.target_note_id.is_(None),
                Link.target_title == key,
            )
            .values(target_note_id=note.id)
        )


async def unresolve_links_for_renamed_note(db: AsyncSession, note: Note, old_title: str, old_path: str) -> None:
    """When a note is renamed, drop resolution for links written against the old
    name (Nodum does not rewrite users' markdown silently). Caller commits."""
    from sqlalchemy import update

    old_keys = {old_title.lower(), old_path.lower()}
    new_keys = {note.title.lower(), note.path.lower()}
    stale = old_keys - new_keys
    if not stale:
        return
    await db.execute(
        update(Link)
        .where(
            Link.vault_id == note.vault_id,
            Link.target_note_id == note.id,
            Link.target_title.in_(stale),
        )
        .values(target_note_id=None)
    )


# ── Panels ───────────────────────────────────────────────────────────────────


def _snippets_for(content: str, needle_forms: list[str], limit: int = 3) -> list[str]:
    """Return up to ``limit`` lines containing any needle (for backlink context)."""
    snippets: list[str] = []
    lowered_needles = [n.lower() for n in needle_forms]
    for line in content.splitlines():
        low = line.lower()
        if any(n in low for n in lowered_needles):
            snippet = line.strip()
            if len(snippet) > 300:
                snippet = snippet[:300] + "…"
            snippets.append(snippet)
            if len(snippets) >= limit:
                break
    return snippets


async def link_notes(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    source_id: UUID,
    *,
    target: str,
    context: str = "",
) -> ServiceResponse[dict[str, Any]]:
    """Connect two notes by appending a ``[[wikilink]]`` to the source.

    Idempotent without ``context``: when the source already links to the
    target nothing is written (``already_linked`` says so). ``context`` is an
    optional sentence to put the link in; ``{link}`` inside it is replaced by
    the wikilink, which is otherwise appended.
    """
    from app.services import note_service

    src_res = await note_service.get_note(db, vault_id, user_id, source_id)
    if not src_res.success:
        return src_res  # type: ignore[return-value]
    dst_res = await note_service.resolve_note_ref(db, vault_id, user_id, target)
    if not dst_res.success:
        return dst_res  # type: ignore[return-value]
    src, dst = src_res.data, dst_res.data
    assert src is not None and dst is not None
    if src.id == dst.id:
        return ServiceResponse.fail("validation_failed", "A note cannot link to itself.")

    link = f"[[{dst.title}]]"
    targets = {dst.title.lower(), dst.path.lower()}
    already = any(w.target.strip().lower() in targets for w in extract_wikilinks(src.content))
    if already and not context.strip():
        return ServiceResponse.ok({"from": str(src.id), "to": str(dst.id), "inserted": None, "already_linked": True})
    line = context.strip().replace("{link}", link) if context.strip() else f"- {link}"
    if link not in line:
        line = f"{line} {link}"
    body = f"{src.content.rstrip()}\n\n{line}\n"
    saved = await note_service.update_content(db, vault_id, user_id, src.id, content=body)
    if not saved.success:
        return saved  # type: ignore[return-value]
    return ServiceResponse.ok({"from": str(src.id), "to": str(dst.id), "inserted": line, "already_linked": already})


async def unlink_notes(
    db: AsyncSession,
    vault_id: UUID,
    user_id: UUID,
    source_id: UUID,
    *,
    target: str,
) -> ServiceResponse[dict[str, Any]]:
    """Remove every ``[[wikilink]]`` from the source that points at the target.

    Links are derived from the markdown, so unlinking edits the markdown —
    matching spans are spliced out (embeds and links inside code stay).
    Removing nothing is success: the notes end up unlinked either way.
    """
    from app.services import note_service
    from app.utils.markdown_parse import frontmatter_aliases, remove_wikilinks

    src_res = await note_service.get_note(db, vault_id, user_id, source_id)
    if not src_res.success:
        return src_res  # type: ignore[return-value]
    dst_res = await note_service.resolve_note_ref(db, vault_id, user_id, target)
    if not dst_res.success:
        return dst_res  # type: ignore[return-value]
    src, dst = src_res.data, dst_res.data
    assert src is not None and dst is not None
    if src.id == dst.id:
        return ServiceResponse.fail("validation_failed", "A note cannot link to itself.")

    names = {dst.title, dst.path, *frontmatter_aliases(dst.properties or {})}
    new_content, removed = remove_wikilinks(src.content, names)
    if removed:
        saved = await note_service.update_content(db, vault_id, user_id, src.id, content=new_content)
        if not saved.success:
            return saved  # type: ignore[return-value]
    return ServiceResponse.ok({"from": str(src.id), "to": str(dst.id), "removed": removed})


async def get_backlinks(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID
) -> ServiceResponse[dict[str, Any]]:
    """Linked mentions: every note that links to this note, with context lines."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id))
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")

    from app.constants import limits

    # Two queries on purpose. This used to be one, selecting Note.content over
    # every link pointing here and applying MAX_BACKLINK_SOURCES in Python
    # *after* Postgres had returned and decoded every row. On a hub note — an
    # MOC, exactly the pattern this product is for — that transferred thousands
    # of note bodies to render a 200-entry panel, on every note switch.
    #
    # Pass 1 picks the sources and their link counts, without touching content.
    # Note is joined only for the ordering key, so truncation keeps the
    # alphabetically-first 200 and stays stable across requests. The +1 row is
    # the "is there more" sentinel.
    source_rows = (
        await db.execute(
            select(Link.source_note_id, Note.title, func.sum(Link.count).label("total"))
            .join(Note, Note.id == Link.source_note_id)
            .where(Link.vault_id == vault_id, Link.target_note_id == note_id)
            .group_by(Link.source_note_id, Note.title)
            .order_by(Note.title)
            .limit(limits.MAX_BACKLINK_SOURCES + 1)
        )
    ).all()

    truncated = len(source_rows) > limits.MAX_BACKLINK_SOURCES
    source_rows = source_rows[: limits.MAX_BACKLINK_SOURCES]

    # Pass 2 fetches at most MAX_BACKLINK_SOURCES bodies, for the snippets.
    bodies: dict[UUID, tuple[str, str]] = {}
    if source_rows:
        body_rows = (
            await db.execute(
                select(Note.id, Note.path, Note.content).where(
                    Note.vault_id == vault_id,
                    Note.id.in_([row.source_note_id for row in source_rows]),
                )
            )
        ).all()
        bodies = {row.id: (row.path, row.content) for row in body_rows}

    by_source: dict[UUID, dict[str, Any]] = {}
    for src_id, title, total in source_rows:
        path, content = bodies.get(src_id, ("", ""))
        by_source[src_id] = {
            "note_id": str(src_id),
            "title": title,
            "path": path,
            "count": int(total or 0),
            "snippets": _snippets_for(content, [f"[[{note.title}", f"[[{note.path}"]),
        }

    payload: dict[str, Any] = {"note_id": str(note_id), "backlinks": list(by_source.values())}
    if truncated:
        payload["truncated"] = True
    return ServiceResponse.ok(payload)


async def get_outgoing_links(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID
) -> ServiceResponse[dict[str, Any]]:
    """Outgoing links of a note, resolved and unresolved."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note.id).where(Note.id == note_id, Note.vault_id == vault_id))
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")

    rows = (
        await db.execute(
            select(Link, Note.title, Note.path)
            .outerjoin(Note, Note.id == Link.target_note_id)
            .where(Link.vault_id == vault_id, Link.source_note_id == note_id)
            .order_by(Link.target_title)
        )
    ).all()

    outgoing = [
        {
            "target_title": link.target_title,
            "target_note_id": str(link.target_note_id) if link.target_note_id else None,
            "resolved_title": title,
            "resolved_path": path,
            "is_embed": link.is_embed,
            "count": link.count,
        }
        for link, title, path in rows
    ]
    return ServiceResponse.ok({"note_id": str(note_id), "outgoing": outgoing})


async def get_unlinked_mentions(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID, *, limit: int = 20
) -> ServiceResponse[dict[str, Any]]:
    """Notes whose text mentions this note's title without linking to it."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.vault_id == vault_id))
    if note is None:
        return ServiceResponse.fail("not_found", "Note not found.")

    from sqlalchemy import text as sql_text
    from sqlalchemy.exc import DBAPIError

    from app.constants import limits

    already_linking = select(Link.source_note_id).where(Link.vault_id == vault_id, Link.target_note_id == note_id)
    try:
        # The %title% scan is sequential by design (no trigram index — too
        # heavy for 2MB contents). LIMIT + a local statement timeout bound it.
        await db.execute(sql_text(f"SET LOCAL statement_timeout = {int(limits.UNLINKED_MENTIONS_TIMEOUT_MS)}"))
        rows = (
            await db.execute(
                select(Note.id, Note.title, Note.path, Note.content)
                .where(
                    Note.vault_id == vault_id,
                    Note.id != note_id,
                    Note.id.not_in(already_linking),
                    Note.content.icontains(note.title, autoescape=True),
                )
                .limit(limit)
            )
        ).all()
    except DBAPIError as exc:
        origin = type(getattr(exc, "orig", exc)).__name__
        if "QueryCanceled" not in origin and "QueryCanceled" not in str(exc):
            raise
        await db.rollback()
        logger.warning("unlinked_mentions_timeout", vault_id=str(vault_id), note_id=str(note_id))
        return ServiceResponse.ok({"note_id": str(note_id), "unlinked_mentions": [], "timed_out": True})

    mentions = []
    link_form = f"[[{note.title.lower()}"
    for src_id, title, path, content in rows:
        # Skip lines where the mention is already a wikilink form
        lines = [ln for ln in _snippets_for(content, [note.title], limit=3) if link_form not in ln.lower()]
        if lines:
            mentions.append({"note_id": str(src_id), "title": title, "path": path, "snippets": lines})

    return ServiceResponse.ok({"note_id": str(note_id), "unlinked_mentions": mentions})


# ── Graph ────────────────────────────────────────────────────────────────────


async def get_graph(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """Whole-vault graph: nodes (notes + unresolved ghosts) and edges.

    Layout is client-side (GPU force simulation); the server only ships the
    topology. Cached in Redis per vault; note/link writes invalidate.

    Response shape (index-based edges keep the payload compact):
        nodes: [{id, title, path, folder, degree, unresolved, tags}]
        edges: [[source_index, target_index], ...]
    """
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    cache_key = vault_graph_key(vault_id)
    cached = await cache_get_json(cache_key)
    if cached is not None:
        return ServiceResponse.ok(cached)

    from app.constants import limits

    note_rows = (
        await db.execute(
            select(Note.id, Note.title, Note.path, Note.created_at)
            .where(Note.vault_id == vault_id)
            .order_by(Note.updated_at.desc())
            .limit(limits.MAX_GRAPH_NODES + 1)
        )
    ).all()
    truncated = len(note_rows) > limits.MAX_GRAPH_NODES
    if truncated:
        note_rows = note_rows[: limits.MAX_GRAPH_NODES]
    link_rows = (
        await db.execute(
            select(Link.source_note_id, Link.target_note_id, Link.target_title).where(Link.vault_id == vault_id)
        )
    ).all()

    from app.models.tags import NoteTag, Tag

    tag_rows = (
        await db.execute(
            select(NoteTag.note_id, Tag.name).join(Tag, Tag.id == NoteTag.tag_id).where(Tag.vault_id == vault_id)
        )
    ).all()
    tags_by_note: dict[str, list[str]] = {}
    for nid, tag_name in tag_rows:
        tags_by_note.setdefault(str(nid), []).append(tag_name)

    nodes: list[dict[str, Any]] = []
    index_of: dict[str, int] = {}

    for note_id, title, path, created_at in note_rows:
        index_of[str(note_id)] = len(nodes)
        folder = path.rsplit("/", 1)[0] if "/" in path else ""
        nodes.append(
            {
                "id": str(note_id),
                "title": title,
                "path": path,
                "folder": folder,
                "degree": 0,
                "unresolved": False,
                "tags": sorted(tags_by_note.get(str(note_id), [])),
                "created_at": created_at.isoformat(),
            }
        )

    edges: list[list[int]] = []
    ghost_index: dict[str, int] = {}
    for source_id, target_id, target_title in link_rows:
        src = index_of.get(str(source_id))
        if src is None:
            continue
        if target_id is not None:
            dst = index_of.get(str(target_id))
            if dst is None:
                continue
        else:
            dst = ghost_index.get(target_title)
            if dst is None:
                if len(nodes) >= limits.MAX_GRAPH_NODES:
                    truncated = True
                    continue
                dst = len(nodes)
                ghost_index[target_title] = dst
                nodes.append(
                    {
                        "id": f"ghost:{target_title}",
                        "title": target_title,
                        "path": "",
                        "folder": "",
                        "degree": 0,
                        "unresolved": True,
                        "tags": [],
                        "created_at": None,
                    }
                )
        edges.append([src, dst])
        nodes[src]["degree"] += 1
        nodes[dst]["degree"] += 1

    graph: dict[str, Any] = {"vault_id": str(vault_id), "nodes": nodes, "edges": edges}
    if truncated:
        graph["truncated"] = True
    await cache_set_json(cache_key, graph, get_settings().CACHE_GRAPH_TTL)
    return ServiceResponse.ok(graph)


async def get_local_graph(
    db: AsyncSession, vault_id: UUID, user_id: UUID, note_id: UUID, *, depth: int = 1
) -> ServiceResponse[dict[str, Any]]:
    """Neighborhood subgraph around one note (depth 1-5), filtered from the
    cached whole-vault graph so repeated local views stay cheap."""
    depth = max(1, min(depth, 5))
    full = await get_graph(db, vault_id, user_id)
    if not full.success:
        return full

    graph = full.data
    assert graph is not None
    start = next((i for i, n in enumerate(graph["nodes"]) if n["id"] == str(note_id)), None)
    if start is None:
        return ServiceResponse.fail("not_found", "Note not found in graph.")

    neighbors: dict[int, set[int]] = {}
    for s, d in graph["edges"]:
        neighbors.setdefault(s, set()).add(d)
        neighbors.setdefault(d, set()).add(s)

    keep: set[int] = {start}
    frontier = {start}
    for _ in range(depth):
        frontier = {n for f in frontier for n in neighbors.get(f, set())} - keep
        keep |= frontier

    remap: dict[int, int] = {}
    sub_nodes: list[dict[str, Any]] = []
    for old_idx in sorted(keep):
        remap[old_idx] = len(sub_nodes)
        sub_nodes.append(graph["nodes"][old_idx])
    sub_edges = [[remap[s], remap[d]] for s, d in graph["edges"] if s in keep and d in keep]

    return ServiceResponse.ok(
        {"vault_id": str(vault_id), "center": str(note_id), "nodes": sub_nodes, "edges": sub_edges}
    )
