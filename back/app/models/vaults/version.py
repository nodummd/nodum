"""Note version model — server-side content snapshots for version history."""

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class NoteVersion(UUIDMixin, TimestampMixin, Base):
    """A point-in-time snapshot of a note (title + content).

    Written on save when content changed and the newest snapshot is older
    than the snapshot interval; pruned to ``NOTE_VERSIONS_KEPT`` nightly.
    """

    __tablename__ = "note_versions"

    note_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (Index("ix_note_versions_note_created", "note_id", text("created_at DESC")),)
