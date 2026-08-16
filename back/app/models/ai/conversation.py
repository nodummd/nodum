"""Saved AI chats.

A conversation belongs to one vault: the assistant's tools act on that vault, so
its history only makes sense there. Server-side rather than in the browser
because the transcript is the user's work — it should survive a reload, a new
device, and a browser that clears storage.

The transcript is also what gets sent to the provider on the next turn, so it is
built from these rows rather than from whatever the client posts.
"""

from datetime import datetime
from typing import Any
from uuid import UUID as UUIDType

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class AIConversation(UUIDMixin, TimestampMixin, Base):
    """One chat thread in one vault."""

    __tablename__ = "ai_conversations"

    user_id: Mapped[UUIDType] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    vault_id: Mapped[UUIDType] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False
    )
    # Taken from the opening question — a thread needs a name in the list before
    # anyone would think to give it one.
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New chat")

    __table_args__ = (
        # The list is always "this user's chats in this vault, newest first".
        Index("ix_ai_conversations_user_vault_updated", "user_id", "vault_id", "updated_at"),
    )

    def __repr__(self) -> str:
        return f"<AIConversation {self.title!r}>"


class AIMessage(UUIDMixin, Base):
    """One turn. `actions` records what the assistant did to the vault, so a
    reloaded transcript still shows the notes it created."""

    __tablename__ = "ai_messages"

    conversation_id: Mapped[UUIDType] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Messages are append-only, so there is nothing for an updated_at to say.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_ai_messages_conversation", "conversation_id", "created_at"),)

    def __repr__(self) -> str:
        return f"<AIMessage {self.role}>"
