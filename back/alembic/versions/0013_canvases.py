"""canvases (JSON Canvas boards)

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "canvases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vault_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("data", JSONB(), server_default='{"nodes": [], "edges": []}', nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["vault_id"], ["vaults.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("vault_id", "name", name="uq_canvases_vault_name"),
    )
    op.create_index("ix_canvases_vault", "canvases", ["vault_id"])


def downgrade() -> None:
    op.drop_index("ix_canvases_vault", table_name="canvases")
    op.drop_table("canvases")
