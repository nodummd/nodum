"""Public API — links: connect, disconnect, and inspect the connections."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.api.public.deps import ReadUser, WriteUser
from app.api.public.schemas import Envelope, LinkCreate, LinkResult, UnlinkResult
from app.dependencies.db import SessionDep
from app.services import link_service

router = APIRouter()


@router.post(
    "/{note_id}/links",
    summary="Link two notes",
    status_code=status.HTTP_201_CREATED,
    response_model=Envelope[LinkResult],
    response_model_by_alias=True,
)
async def link_notes(vault_id: UUID, note_id: UUID, body: LinkCreate, user_id: WriteUser, db: SessionDep) -> Any:
    """Append a `[[wikilink]]` to this note pointing at `target` (id, path or title).

    Idempotent without `context`: an existing link means nothing is written
    and `already_linked` is true.
    """
    return {
        "data": (
            await link_service.link_notes(db, vault_id, user_id, note_id, target=body.target, context=body.context)
        ).unwrap()
    }


@router.delete(
    "/{note_id}/links", summary="Unlink two notes", response_model=Envelope[UnlinkResult], response_model_by_alias=True
)
async def unlink_notes(
    vault_id: UUID,
    note_id: UUID,
    user_id: WriteUser,
    db: SessionDep,
    target: str = Query(min_length=1, description="The note to unlink from: its id, path or title."),
) -> Any:
    """Remove every `[[wikilink]]` in this note that points at `target`.

    Links live in the markdown, so this edits the markdown: matching links are
    spliced out (embeds and links inside code are left alone). `removed: 0`
    still succeeds — the notes end up unlinked either way.
    """
    return {"data": (await link_service.unlink_notes(db, vault_id, user_id, note_id, target=target)).unwrap()}


@router.get("/{note_id}/links", summary="Outgoing links")
async def get_outgoing_links(vault_id: UUID, note_id: UUID, user_id: ReadUser, db: SessionDep) -> dict[str, Any]:
    """Links FROM this note — resolved (with target id/path) and unresolved."""
    return {"data": (await link_service.get_outgoing_links(db, vault_id, user_id, note_id)).unwrap()}


@router.get("/{note_id}/backlinks", summary="Backlinks")
async def get_backlinks(vault_id: UUID, note_id: UUID, user_id: ReadUser, db: SessionDep) -> dict[str, Any]:
    """Notes that link TO this note, with the sentence around each link."""
    return {"data": (await link_service.get_backlinks(db, vault_id, user_id, note_id)).unwrap()}


@router.get("/{note_id}/unlinked-mentions", summary="Unlinked mentions")
async def get_unlinked_mentions(
    vault_id: UUID,
    note_id: UUID,
    user_id: ReadUser,
    db: SessionDep,
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    """Notes whose text mentions this note's title without linking to it."""
    return {"data": (await link_service.get_unlinked_mentions(db, vault_id, user_id, note_id, limit=limit)).unwrap()}
