"""Link & graph endpoints — backlinks, outgoing, unlinked mentions, graph views."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import link_service

router = APIRouter()


@router.get("/notes/{note_id}/backlinks")
async def backlinks(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Linked mentions of a note, with context snippets."""
    data = (await link_service.get_backlinks(db, vault_id, user_id, note_id)).unwrap()
    return {"data": data}


@router.get("/notes/{note_id}/outgoing")
async def outgoing(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Outgoing links of a note (resolved + unresolved)."""
    data = (await link_service.get_outgoing_links(db, vault_id, user_id, note_id)).unwrap()
    return {"data": data}


@router.get("/notes/{note_id}/unlinked-mentions")
async def unlinked_mentions(vault_id: UUID, note_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Plain-text mentions of this note's title that are not links yet."""
    data = (await link_service.get_unlinked_mentions(db, vault_id, user_id, note_id)).unwrap()
    return {"data": data}


@router.get("/notes/{note_id}/related")
async def related_notes(
    vault_id: UUID,
    note_id: UUID,
    user_id: CurrentUserId,
    db: SessionDep,
    limit: int = Query(default=5, ge=1, le=20),
) -> dict[str, Any]:
    """Semantically related notes (pgvector cosine distance over embeddings)."""
    from sqlalchemy import select

    from app.core.custom_exceptions import NotFoundError
    from app.models.vaults import Note
    from app.services.vault_service import get_owned_vault

    if await get_owned_vault(db, vault_id, user_id) is None:
        raise NotFoundError("Vault not found.")
    target = await db.scalar(select(Note.embedding).where(Note.id == note_id, Note.vault_id == vault_id))
    if target is None:
        return {"data": {"related": []}}

    from sqlalchemy import text as sql_text
    from sqlalchemy.exc import DBAPIError

    from app.constants import limits

    distance = Note.embedding.cosine_distance(target)
    try:
        # Exact sequential scan, bounded in time — the same bargain
        # get_unlinked_mentions makes. There is no ANN index and cannot be a
        # table-wide one: pgvector post-filters HNSW, so with a vault_id
        # predicate it would return the globally-nearest vectors and only then
        # apply the tenant filter, yielding empty or wrong results.
        await db.execute(sql_text(f"SET LOCAL statement_timeout = {int(limits.RELATED_NOTES_TIMEOUT_MS)}"))
        rows = (
            await db.execute(
                select(Note.id, Note.title, Note.path, distance.label("distance"))
                .where(Note.vault_id == vault_id, Note.id != note_id, Note.embedding.is_not(None))
                .order_by(distance)
                .limit(limit)
            )
        ).all()
    except DBAPIError:
        # A vault big enough to blow the budget degrades to an empty pane
        # rather than holding a worker and a connection.
        await db.rollback()
        return {"data": {"related": [], "timed_out": True}}

    related = [
        {"id": str(r.id), "title": r.title, "path": r.path, "similarity": round(1 - float(r.distance), 3)}
        for r in rows
        if float(r.distance) < 0.95  # drop entirely-unrelated noise
    ]
    return {"data": {"related": related}}


@router.get("/graph")
async def graph(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Whole-vault knowledge graph (cached)."""
    data = (await link_service.get_graph(db, vault_id, user_id)).unwrap()
    return {"data": data}


@router.get("/notes/{note_id}/local-graph")
async def local_graph(
    vault_id: UUID,
    note_id: UUID,
    user_id: CurrentUserId,
    db: SessionDep,
    depth: int = Query(default=1, ge=1, le=5),
) -> dict[str, Any]:
    """Neighborhood graph around a note."""
    data = (await link_service.get_local_graph(db, vault_id, user_id, note_id, depth=depth)).unwrap()
    return {"data": data}
