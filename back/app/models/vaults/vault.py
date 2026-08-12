"""Vault model — a user's knowledge base container."""

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Vault(UUIDMixin, TimestampMixin, Base):
    """One vault = one isolated notes workspace (like an Obsidian vault).

    ``settings`` holds per-vault config: daily-note format/folder/template,
    templates folder, attachment folder, graph display preferences.
    """

    __tablename__ = "vaults"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_vaults_user_name"),)

    def __repr__(self) -> str:
        return f"<Vault {self.name}>"
