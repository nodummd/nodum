"""Per-user AI provider credentials.

Its own table rather than a key in `users.settings`: that blob is serialized to
the browser in full on signup, login, refresh and every `PATCH /auth/me`, and the
same endpoint lets the client write arbitrary keys into it. A credential must be
readable only by the server, so it lives where the client can never see it — and
the key column holds ciphertext, never the key itself (see `crypto_utils`).
"""

from uuid import UUID as UUIDType

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class AICredential(UUIDMixin, TimestampMixin, Base):
    """One stored provider key per user per provider — at account level
    (`vault_id` NULL, used by every vault) or for one vault."""

    __tablename__ = "ai_credentials"

    user_id: Mapped[UUIDType] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # NULL = the account's key; set = this vault's own key, which wins for it.
    vault_id: Mapped[UUIDType | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("vaults.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # "anthropic" | "openai" | "gemini" | "qwen" — validated at the schema edge
    # so a new provider needs no migration.
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    # `v1:<fernet token>`; never returned by any endpoint.
    key_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    # Enough to recognise which key is stored ("sk-ant…7f2a") without revealing it.
    key_hint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    # Self-hosted, proxied or regional endpoints (Qwen has several).
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    __table_args__ = (
        Index(
            "uq_ai_credentials_account",
            "user_id",
            "provider",
            unique=True,
            postgresql_where=text("vault_id IS NULL"),
        ),
        Index(
            "uq_ai_credentials_vault",
            "user_id",
            "provider",
            "vault_id",
            unique=True,
            postgresql_where=text("vault_id IS NOT NULL"),
        ),
    )

    def __repr__(self) -> str:
        return f"<AICredential {self.provider} user={self.user_id}>"
