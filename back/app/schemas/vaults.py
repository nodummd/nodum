"""Vault/folder/note request & response schemas."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.constants.limits import MAX_NOTE_SIZE_BYTES, MAX_TITLE_LENGTH

# ── Vaults ───────────────────────────────────────────────────────────────────


class VaultCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)


class VaultUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    settings: dict[str, Any] | None = None


class VaultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    settings: dict[str, Any]
    created_at: datetime
    updated_at: datetime


# ── Folders ──────────────────────────────────────────────────────────────────


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    parent_id: UUID | None = None


class FolderRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)


class FolderMoveRequest(BaseModel):
    new_parent_id: UUID | None = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parent_id: UUID | None
    name: str
    path: str


# ── Notes ────────────────────────────────────────────────────────────────────


class NoteCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    folder_id: UUID | None = None
    # Alternative to folder_id: slash path, missing folders are created
    folder_path: str | None = Field(default=None, max_length=1024)
    content: str = Field(default="", max_length=MAX_NOTE_SIZE_BYTES)


class NoteContentUpdateRequest(BaseModel):
    content: str = Field(max_length=MAX_NOTE_SIZE_BYTES)
    # Optimistic concurrency guard — server's updated_at the client last saw.
    base_updated_at: datetime | None = None


class NoteRenameRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    folder_id: UUID | None = None
    move_to_root: bool = False


class NoteTagsRequest(BaseModel):
    """Add/remove frontmatter tags (leading '#' optional, case-insensitive)."""

    add: list[str] = Field(default_factory=list, max_length=50)
    remove: list[str] = Field(default_factory=list, max_length=50)


class NoteMetaOut(BaseModel):
    """Note without content — for lists and tree responses."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    folder_id: UUID | None
    title: str
    path: str
    word_count: int
    properties: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class NoteOut(NoteMetaOut):
    """Full note including markdown content."""

    content: str
