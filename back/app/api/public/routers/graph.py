"""Public API — the knowledge graph."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query

from app.api.public.deps import ReadUser
from app.dependencies.db import SessionDep
from app.services import link_service

router = APIRouter()


@router.get("/graph", summary="Whole-vault graph")
async def get_graph(vault_id: UUID, user_id: ReadUser, db: SessionDep) -> dict[str, Any]:
    """Nodes (notes, plus unresolved `ghost:` targets) and edges as node-index pairs."""
    return {"data": (await link_service.get_graph(db, vault_id, user_id)).unwrap()}


@router.get("/notes/{note_id}/graph", summary="Local graph around a note")
async def get_local_graph(
    vault_id: UUID,
    note_id: UUID,
    user_id: ReadUser,
    db: SessionDep,
    depth: int = Query(default=1, ge=1, le=5, description="How many hops out from the note."),
) -> dict[str, Any]:
    return {"data": (await link_service.get_local_graph(db, vault_id, user_id, note_id, depth=depth)).unwrap()}
