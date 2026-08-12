"""Note model — a markdown document inside a vault."""

from typing import Any
from uuid import UUID

from sqlalchemy import Computed, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Note(UUIDMixin, TimestampMixin, Base):
    """A markdown note.

    Identity follows Obsidian semantics:
    - ``title``  — the display name (filename without ``.md``), used for
      ``[[wikilink]]`` resolution; indexed per vault.
    - ``path``   — full vault-relative path including title ("Projects/Idea"),
      unique per vault. No ``.md`` suffix is stored.
    - ``properties`` — parsed YAML frontmatter as JSONB.
    """

    __tablename__ = "notes"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    folder_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="CASCADE"),
        nullable=True,
        default=None,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # Full-text search vector — DB-generated (title weighted A, body B),
    # deferred so the ORM never fetches it into note payloads.
    content_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
            "setweight(to_tsvector('english', coalesce(content, '')), 'B')",
            persisted=True,
        ),
        nullable=True,
        deferred=True,
    )

    __table_args__ = (
        UniqueConstraint("vault_id", "path", name="uq_notes_vault_path"),
        Index("ix_notes_vault_title", "vault_id", "title"),
        Index("ix_notes_vault_folder", "vault_id", "folder_id"),
        Index("ix_notes_vault_updated", "vault_id", "updated_at"),
        Index("ix_notes_content_tsv", "content_tsv", postgresql_using="gin"),
        # Trigram index for fuzzy quick-switcher title matching (needs pg_trgm)
        Index(
            "ix_notes_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:
        return f"<Note {self.path}>"
