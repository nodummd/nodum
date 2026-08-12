"""Folder model — nested folders with a materialized path."""

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Folder(UUIDMixin, TimestampMixin, Base):
    """A folder inside a vault.

    ``path`` is the materialized full path ("Projects/Active") — unique per
    vault, recomputed for the subtree on rename/move. Root-level folders have
    ``parent_id`` NULL and ``path`` == ``name``.
    """

    __tablename__ = "folders"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="CASCADE"),
        nullable=True,
        default=None,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint("vault_id", "path", name="uq_folders_vault_path"),
        Index("ix_folders_vault_parent", "vault_id", "parent_id"),
    )

    def __repr__(self) -> str:
        return f"<Folder {self.path}>"
