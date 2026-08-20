"""api_tokens: scopes (the public-API key permissions)

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing rows are all kind="mcp", whose empty scope list means "kind-
    # implied full access" — so no backfill. kind="key" rows are minted with
    # at least one validated scope from day one.
    op.add_column(
        "api_tokens",
        sa.Column(
            "scopes",
            postgresql.ARRAY(sa.String(length=16)),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("api_tokens", "scopes")
