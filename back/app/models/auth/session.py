"""Session model — refresh-token sessions with JTI rotation."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.auth.user import User


class Session(UUIDMixin, TimestampMixin, Base):
    """One row per login. The refresh JTI rotates on every refresh;
    presenting a stale JTI invalidates the session (token-reuse defense).
    Access tokens are short-lived and stateless — never stored.
    """

    __tablename__ = "sessions"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    refresh_token_jti: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    invalidation_reason: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)

    __table_args__ = (
        Index(
            "idx_sessions_active_by_user",
            "user_id",
            postgresql_where=("is_active = true AND invalidated_at IS NULL"),
        ),
    )

    user: Mapped["User"] = relationship("User", back_populates="sessions")

    @property
    def is_valid(self) -> bool:
        """True if active, unexpired, and not invalidated."""
        return self.is_active and self.invalidated_at is None and self.expires_at > datetime.now(UTC)

    def invalidate(self, reason: str = "user_logout") -> None:
        """Mark this session as invalidated (audit-friendly, in place)."""
        self.is_active = False
        self.invalidated_at = datetime.now(UTC)
        self.invalidation_reason = reason

    def __repr__(self) -> str:
        return f"<Session user_id={self.user_id}>"
