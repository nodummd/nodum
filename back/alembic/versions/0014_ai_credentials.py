"""ai_credentials (bring-your-own-key provider credentials)

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_credentials",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        # Ciphertext only — see app/utils/crypto_utils.py.
        sa.Column("key_ciphertext", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.String(length=64), server_default="", nullable=False),
        sa.Column("model", sa.String(length=128), server_default="", nullable=False),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", name="uq_ai_credentials_user_provider"),
    )
    op.create_index("ix_ai_credentials_user", "ai_credentials", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_credentials_user", table_name="ai_credentials")
    op.drop_table("ai_credentials")
