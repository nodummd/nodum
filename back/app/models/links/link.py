"""Link model — one row per (source note → target) edge."""

from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Link(UUIDMixin, TimestampMixin, Base):
    """A wikilink edge extracted from note content.

    ``target_note_id`` is NULL for unresolved links (the target note does not
    exist yet); ``target_title`` always stores the normalized (lowercased)
    target text so unresolved links re-resolve when a matching note appears.
    Deleting the target sets ``target_note_id`` back to NULL (link becomes
    unresolved again) — matching Obsidian semantics.
    """

    __tablename__ = "links"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_note_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_note_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="SET NULL"),
        nullable=True,
        default=None,
    )
    # Normalized (lowercased) target as written: a title ("idea") or path ("projects/idea")
    target_title: Mapped[str] = mapped_column(String(1024), nullable=False)
    is_embed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        UniqueConstraint("source_note_id", "target_title", "is_embed", name="uq_links_source_target"),
        Index("ix_links_vault_source", "vault_id", "source_note_id"),
        Index("ix_links_vault_target_note", "vault_id", "target_note_id"),
        Index("ix_links_vault_target_title", "vault_id", "target_title"),
    )

    def __repr__(self) -> str:
        return f"<Link {self.source_note_id} → {self.target_title}>"
