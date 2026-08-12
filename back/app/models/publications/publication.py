"""Publication model — public read-only share links for notes."""

import secrets
from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


def new_share_token() -> str:
    """URL-safe, unguessable share token (128 bits)."""
    return secrets.token_urlsafe(16)


class Publication(UUIDMixin, TimestampMixin, Base):
    """A published note: anyone with the token can read it (no auth)."""

    __tablename__ = "publications"

    note_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True, default=new_share_token)

    __table_args__ = (UniqueConstraint("note_id", name="uq_publications_note"),)
