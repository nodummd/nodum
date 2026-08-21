"""Public API — vaults."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.api.public.deps import ReadUser
from app.api.public.schemas import Envelope, PublicVault
from app.dependencies.db import SessionDep
from app.services import vault_service

router = APIRouter()


@router.get("", summary="List vaults", response_model=Envelope[list[PublicVault]])
async def list_vaults(user_id: ReadUser, db: SessionDep) -> Any:
    """Every vault the key's owner has. Almost every other call needs a `vault_id` from here."""
    return {"ok": True, "data": (await vault_service.list_vaults(db, user_id)).unwrap()}


@router.get("/{vault_id}/tree", summary="Folder & note tree")
async def get_tree(vault_id: UUID, user_id: ReadUser, db: SessionDep) -> dict[str, Any]:
    """The whole vault as a tree of folders and note titles (no bodies).

    Very large vaults set `truncated: true`; use *List notes* for the rest.
    """
    return {"ok": True, "data": (await vault_service.get_tree(db, vault_id, user_id)).unwrap()}
