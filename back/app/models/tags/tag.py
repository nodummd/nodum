"""Tag models — vault-scoped tags with a note association table."""

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Tag(UUIDMixin, TimestampMixin, Base):
    """A tag within a vault.

    ``name`` is stored lowercased (Obsidian matches tags case-insensitively);
    nested tags keep their ``/`` separators ("projects/nodum").
    """

    __tablename__ = "tags"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    __table_args__ = (UniqueConstraint("vault_id", "name", name="uq_tags_vault_name"),)

    def __repr__(self) -> str:
        return f"<Tag #{self.name}>"


class NoteTag(Base):
    """Association: note ↔ tag (composite PK, no surrogate id needed)."""

    __tablename__ = "note_tags"

    note_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    __table_args__ = (Index("ix_note_tags_tag", "tag_id"),)
