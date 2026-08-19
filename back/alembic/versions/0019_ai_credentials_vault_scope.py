"""ai_credentials: optional vault scope (a vault may bring its own key)

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL = the account's key (used by every vault that has none of its own).
    op.add_column("ai_credentials", sa.Column("vault_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_ai_credentials_vault", "ai_credentials", "vaults", ["vault_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_ai_credentials_vault", "ai_credentials", ["vault_id"])
    # One key per (user, provider) at account level, one per (user, provider,
    # vault) per vault. Two partial indexes rather than NULLS NOT DISTINCT so the
    # rule reads the same on every Postgres this runs on.
    op.drop_constraint("uq_ai_credentials_user_provider", "ai_credentials", type_="unique")
    op.create_index(
        "uq_ai_credentials_account",
        "ai_credentials",
        ["user_id", "provider"],
        unique=True,
        postgresql_where=sa.text("vault_id IS NULL"),
    )
    op.create_index(
        "uq_ai_credentials_vault",
        "ai_credentials",
        ["user_id", "provider", "vault_id"],
        unique=True,
        postgresql_where=sa.text("vault_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM ai_credentials WHERE vault_id IS NOT NULL")
    op.drop_index("uq_ai_credentials_vault", table_name="ai_credentials")
    op.drop_index("uq_ai_credentials_account", table_name="ai_credentials")
    op.create_unique_constraint("uq_ai_credentials_user_provider", "ai_credentials", ["user_id", "provider"])
    op.drop_index("ix_ai_credentials_vault", table_name="ai_credentials")
    op.drop_constraint("fk_ai_credentials_vault", "ai_credentials", type_="foreignkey")
    op.drop_column("ai_credentials", "vault_id")
