"""Public API request/response models.

The OpenAPI document these produce IS the product: every field that reaches
the reference docs should say what it means. Core note/vault shapes are
reused from app.schemas.vaults so the public API can never drift from the app.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.constants.limits import MAX_NOTE_SIZE_BYTES
from app.schemas.vaults import NoteMetaOut, NoteOut


class Envelope[T](BaseModel):
    """Every success response: `ok` plus the payload under `data`.

    `ok` is redundant next to the HTTP status on purpose — clients that
    funnel every call through one helper can branch on the body alone,
    which is exactly what most SDK wrappers end up doing.
    """

    ok: bool = Field(default=True, description="Always `true` on a success response.")
    data: T


class ErrorInfo(BaseModel):
    code: str = Field(
        description="Stable machine-readable code in SCREAMING_SNAKE_CASE, e.g. `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`."
    )
    details: str = Field(
        description="The specifics: which field, which scope, what conflicted. Falls back to `message`."
    )
    message: str = Field(description="Short human-readable explanation.")


class ErrorResponse(BaseModel):
    """Every error response: `{"ok": false, "error": {"code", "details", "message"}}`."""

    ok: bool = Field(default=False, description="Always `false` on an error response.")
    error: ErrorInfo


# ── Vaults ───────────────────────────────────────────────────────────────────


class PublicVault(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    created_at: datetime
    updated_at: datetime


# ── Notes ────────────────────────────────────────────────────────────────────


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200, examples=["Reading list"])
    folder: str | None = Field(
        default=None,
        description='Folder path ("Projects/Alpha"). Missing folders are created. Omit for the vault root.',
        examples=["Projects/Alpha"],
    )
    content: str = Field(
        default="",
        max_length=MAX_NOTE_SIZE_BYTES,
        description="Markdown body. Link other notes with [[Their title]] — links resolve immediately.",
    )


class NoteContentUpdate(BaseModel):
    content: str = Field(max_length=MAX_NOTE_SIZE_BYTES, description="Markdown to write.")
    mode: str = Field(
        default="replace",
        pattern="^(replace|append|prepend)$",
        description='"replace" the whole body, "append" to the end, or "prepend" below the frontmatter.',
    )
    base_updated_at: datetime | None = Field(
        default=None,
        description=(
            "Optimistic-concurrency guard for replace: the `updated_at` you last read. "
            "A mismatch returns 409 with `details.server_updated_at`."
        ),
    )


class NoteMove(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200, description="New title (rename).")
    folder: str | None = Field(
        default=None, description='Move into this folder path ("" moves to the vault root). Created if missing.'
    )


class NoteWriteOut(BaseModel):
    """What a write returns: the note's identity, location and timestamps —
    never its body. Reading content back requires the `read` scope, so a
    write-only key (a capture webhook, say) cannot exfiltrate a vault."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    folder_id: UUID | None
    title: str
    path: str
    created_at: datetime
    updated_at: datetime = Field(description="Feed this back as `base_updated_at` on your next replace.")


class NoteList(BaseModel):
    items: list[NoteMetaOut]
    total: int = Field(description="How many notes match in all — for pagination.")
    limit: int
    offset: int


class NoteTagsUpdate(BaseModel):
    add: list[str] = Field(default_factory=list, max_length=50, description='Tags to add (leading "#" optional).')
    remove: list[str] = Field(default_factory=list, max_length=50)


# ── Search ───────────────────────────────────────────────────────────────────


class SearchHit(BaseModel):
    id: str
    title: str
    path: str
    snippet: str = Field(description="Matched text with <mark>…</mark> around the hits.")
    rank: float
    created_at: str
    updated_at: str


class SearchData(BaseModel):
    query: str
    results: list[SearchHit]
    total: int = Field(description="How many notes match in all — for pagination.")


class QuickSwitchHit(BaseModel):
    id: str
    title: str
    path: str
    score: float
    alias: str | None = Field(default=None, description="Set when the match was a frontmatter alias.")


# ── Links ────────────────────────────────────────────────────────────────────


class LinkCreate(BaseModel):
    target: str = Field(description="The note to link to: its id, path or title.", examples=["Projects/Alpha"])
    context: str = Field(
        default="",
        description="Optional sentence to put the link in; `{link}` is replaced by the wikilink. "
        "Empty appends `- [[Target]]`.",
    )


class LinkResult(BaseModel):
    from_id: str = Field(alias="from", description="Source note id.")
    to_id: str = Field(alias="to", description="Target note id.")
    inserted: str | None = Field(description="The line written, or null when it was already linked.")
    already_linked: bool

    model_config = ConfigDict(populate_by_name=True)


class UnlinkResult(BaseModel):
    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    removed: int = Field(description="How many [[wikilinks]] were removed. 0 is success too — already unlinked.")

    model_config = ConfigDict(populate_by_name=True)


# ── Tags ─────────────────────────────────────────────────────────────────────


class TagOut(BaseModel):
    name: str
    count: int


class TagNoteOut(BaseModel):
    id: str
    title: str
    path: str


class TagNotesData(BaseModel):
    name: str
    notes: list[TagNoteOut]


# ── Attachments ──────────────────────────────────────────────────────────────


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime


class PresignedUrlData(BaseModel):
    url: str = Field(description="Time-limited download URL.")
    expires_in: int = Field(description="Seconds until the URL stops working.")


# ── AI ───────────────────────────────────────────────────────────────────────


class AiAsk(BaseModel):
    message: str = Field(min_length=1, max_length=8000, examples=["What do my notes say about spaced repetition?"])
    conversation_id: UUID | None = Field(
        default=None, description="Continue an earlier conversation; omit to start a new one."
    )
    context: str = Field(default="", max_length=8000, description="Optional extra context for this turn.")


class AiAnswer(BaseModel):
    conversation_id: str
    title: str
    reply: str = Field(description="The assistant's whole answer, as markdown.")
    provider: str
    model: str
    actions: list[dict[str, Any]] = Field(description="Vault actions the assistant took (tool calls), if any.")


__all__ = ["NoteMetaOut", "NoteOut"]
