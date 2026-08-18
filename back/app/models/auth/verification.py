"""Email verification codes — one short-lived OTP per user at a time."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EmailVerification(UUIDMixin, TimestampMixin, Base):
    """A pending email-verification code.

    The code itself is never stored — only an HMAC of it, keyed with the app
    secret. Six digits is a 10^6 space, small enough that a plain digest would
    be trivially reversible from a database dump; an HMAC is not without the
    key. Attempts are counted on the row so a leaked code space cannot be
    walked, and issuing a new code replaces the old one.
    """

    __tablename__ = "email_verifications"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # What the code authorises: "signup", "password_reset" or "account_delete".
    # Scoping every lookup by it is what stops one flow's code from being
    # spent on another — a reset code must not delete an account.
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, default="signup", server_default="signup")
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    # Which provider accepted the message (or "dev" when nothing was sent) —
    # the only breadcrumb when a user swears the mail never arrived.
    delivered_via: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)

    def __repr__(self) -> str:
        return f"<EmailVerification {self.purpose} user={self.user_id} expires={self.expires_at}>"
