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
