"""Long-lived, revocable API tokens — the credential an MCP client sends.

Distinct from a session: a session is a browser that logged in and refreshes;
a token is a thing a person pastes into another program once. It is stored
hashed (SHA-256 is right — 256 bits of CSPRNG output has no structure a slow
KDF would protect), shown in plaintext exactly once, and revoked by setting
`revoked_at` rather than deleting, so "when did this stop working" stays
answerable.
"""

from datetime import datetime
from uuid import UUID as UUIDType

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ApiToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "api_tokens"

    user_id: Mapped[UUIDType] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "mcp" today; the column exists so a second kind needs no migration.
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="mcp")
    # What the person called it ("Claude Desktop on the laptop").
    name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # The last few characters, so a list of tokens is tellable apart.
    hint: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<ApiToken {self.kind} {self.name!r}>"
