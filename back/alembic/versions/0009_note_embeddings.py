"""note embeddings (pgvector)

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("notes", sa.Column("embedding", Vector(384), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "embedding")
