"""Canvas model — JSON Canvas boards (Obsidian-compatible format)."""

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Canvas(UUIDMixin, TimestampMixin, Base):
    """A spatial board: ``data`` holds JSON Canvas {nodes, edges}."""

    __tablename__ = "canvases"

    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default='{"nodes": [], "edges": []}'
    )

    __table_args__ = (UniqueConstraint("vault_id", "name", name="uq_canvases_vault_name"),)
