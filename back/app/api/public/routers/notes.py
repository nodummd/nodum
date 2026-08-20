"""Public API — notes: list, read, create, edit, move, tag, delete."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.api.public.deps import DeleteUser, ReadUser, WriteUser
from app.api.public.schemas import (
    Envelope,
    NoteContentUpdate,
    NoteCreate,
    NoteList,
    NoteMove,
    NoteOut,
    NoteTagsUpdate,
)
from app.dependencies.db import SessionDep
from app.services import folder_service, note_service
from app.utils.markdown_parse import _FRONTMATTER_RE

router = APIRouter()


def _compose(existing: str, content: str, mode: str) -> str:
    """append/prepend against the current body; prepend stays below frontmatter."""
    if mode == "append":
        return f"{existing.rstrip()}\n\n{content.strip()}\n"
    fm = _FRONTMATTER_RE.match(existing)
    if fm:
        head, rest = existing[: fm.end()], existing[fm.end() :]
        return f"{head}\n{content.strip()}\n\n{rest.lstrip()}"
    return f"{content.strip()}\n\n{existing.lstrip()}"


@router.get("", summary="List notes", response_model=Envelope[NoteList])
async def list_notes(
    vault_id: UUID,
    user_id: ReadUser,
    db: SessionDep,
    folder: str | None = Query(default=None, description='Only notes under this folder path, e.g. "Projects".'),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Any:
    """Note metadata (no bodies), most recently updated first. `total` is for pagination."""
    return {
        "data": (
            await note_service.list_notes(db, vault_id, user_id, folder=folder, limit=limit, offset=offset)
        ).unwrap()
    }


@router.post("", summary="Create a note", status_code=status.HTTP_201_CREATED, response_model=Envelope[NoteOut])
async def create_note(vault_id: UUID, body: NoteCreate, user_id: WriteUser, db: SessionDep) -> Any:
    """Create a markdown note. `[[Wikilinks]]` in the content resolve immediately."""
    folder_id: UUID | None = None
    if body.folder and body.folder.strip("/ "):
        folder_id = (await folder_service.ensure_folder_path(db, vault_id, user_id, body.folder.strip("/ "))).unwrap()
    note = (
        await note_service.create_note(
            db, vault_id, user_id, title=body.title, folder_id=folder_id, content=body.content
        )
    ).unwrap()
    return {"data": note}


@router.get("/by-path", summary="Read a note by path", response_model=Envelope[NoteOut])
async def get_note_by_path(
    vault_id: UUID,
    user_id: ReadUser,
    db: SessionDep,
    path: str = Query(min_length=1, description='The note\'s full path, e.g. "Projects/Alpha".'),
) -> Any:
    return {"data": (await note_service.get_note_by_path(db, vault_id, user_id, path)).unwrap()}


@router.get("/{note_id}", summary="Read a note", response_model=Envelope[NoteOut])
async def get_note(vault_id: UUID, note_id: UUID, user_id: ReadUser, db: SessionDep) -> Any:
    """The full note: markdown content, path, tags and other frontmatter properties."""
    return {"data": (await note_service.get_note(db, vault_id, user_id, note_id)).unwrap()}


@router.put("/{note_id}/content", summary="Write a note's body", response_model=Envelope[NoteOut])
async def update_content(
    vault_id: UUID, note_id: UUID, body: NoteContentUpdate, user_id: WriteUser, db: SessionDep
) -> Any:
    """Replace the body, or add to it (`mode: append` / `prepend`).

    For concurrent writers, send `base_updated_at` with `replace`: a stale
    write returns **409** with `details.server_updated_at` so you can merge.
    """
    content = body.content
    if body.mode in ("append", "prepend"):
        existing = (await note_service.get_note(db, vault_id, user_id, note_id)).unwrap()
        content = _compose(existing.content, body.content, body.mode)
    note = (
        await note_service.update_content(
            db,
            vault_id,
            user_id,
            note_id,
            content=content,
            base_updated_at=body.base_updated_at if body.mode == "replace" else None,
        )
    ).unwrap()
    return {"data": note}


@router.patch("/{note_id}", summary="Rename or move a note", response_model=Envelope[NoteOut])
async def move_note(vault_id: UUID, note_id: UUID, body: NoteMove, user_id: WriteUser, db: SessionDep) -> Any:
    """Rename (`title`) and/or move (`folder`; `""` means the vault root) in one call."""
    folder_id: UUID | None = None
    move_to_root = False
    if body.folder is not None:
        cleaned = body.folder.strip("/ ")
        if cleaned:
            folder_id = (await folder_service.ensure_folder_path(db, vault_id, user_id, cleaned)).unwrap()
        else:
            move_to_root = True
    note = (
        await note_service.rename_note(
            db, vault_id, user_id, note_id, title=body.title, folder_id=folder_id, move_to_root=move_to_root
        )
    ).unwrap()
    return {"data": note}


@router.post("/{note_id}/tags", summary="Add or remove tags", response_model=Envelope[NoteOut])
async def set_tags(vault_id: UUID, note_id: UUID, body: NoteTagsUpdate, user_id: WriteUser, db: SessionDep) -> Any:
    """Edits the frontmatter `tags` list; inline `#tags` in the body are left alone."""
    note = (
        await note_service.set_tags(db, vault_id, user_id, note_id, add=body.add or None, remove=body.remove or None)
    ).unwrap()
    return {"data": note}


@router.delete("/{note_id}", summary="Delete a note")
async def delete_note(vault_id: UUID, note_id: UUID, user_id: DeleteUser, db: SessionDep) -> dict[str, Any]:
    """Deletes the note. Links pointing at it become unresolved (ghosts in the graph)."""
    (await note_service.delete_note(db, vault_id, user_id, note_id)).unwrap()
    return {"data": {"deleted": str(note_id)}}
