"""Note alias model — frontmatter ``aliases:`` entries, one row per alias."""

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class NoteAlias(UUIDMixin, Base):
    """An alternate name a note answers to for ``[[wikilink]]`` resolution.

    Uniqueness is per note (case-insensitive) — two notes MAY claim the same
    alias, matching Obsidian; resolution picks the oldest row for stability.
    """

    __tablename__ = "note_aliases"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    note_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    alias: Mapped[str] = mapped_column(String(255), nullable=False)

    __table_args__ = (
        Index("ix_note_aliases_vault_alias_lower", "vault_id", text("lower(alias)")),
        Index("ix_note_aliases_note_id", "note_id"),
        Index("uq_note_aliases_note_alias_lower", "note_id", text("lower(alias)"), unique=True),
    )
