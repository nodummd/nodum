"""ai_conversations (saved AI chat history)

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-16

Autogenerate also proposed dropping ix_canvases_vault and
ix_oauth_connections_user and renaming ix_ai_credentials_user — those indexes
are hand-named in earlier migrations and are doing their job. Removed; this
migration adds the two new tables and nothing else.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("vault_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vault_id"], ["vaults.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_conversations_user_vault_updated",
        "ai_conversations",
        ["user_id", "vault_id", "updated_at"],
    )
    op.create_table(
        "ai_messages",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("conversation_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        # What the assistant did to the vault during this turn, so a reloaded
        # transcript still shows the notes it created.
        sa.Column(
            "actions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["ai_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_messages_conversation", "ai_messages", ["conversation_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_messages_conversation", table_name="ai_messages")
    op.drop_table("ai_messages")
    op.drop_index("ix_ai_conversations_user_vault_updated", table_name="ai_conversations")
    op.drop_table("ai_conversations")
