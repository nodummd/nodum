"""note aliases + note versions

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "note_aliases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vault_id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(["vault_id"], ["vaults.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_note_aliases_vault_alias_lower", "note_aliases", ["vault_id", sa.literal_column("lower(alias)")]
    )
    op.create_index("ix_note_aliases_note_id", "note_aliases", ["note_id"])
    op.create_index(
        "uq_note_aliases_note_alias_lower",
        "note_aliases",
        ["note_id", sa.literal_column("lower(alias)")],
        unique=True,
    )

    op.create_table(
        "note_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_note_versions_note_created", "note_versions", ["note_id", sa.literal_column("created_at DESC")])


def downgrade() -> None:
    op.drop_index("ix_note_versions_note_created", table_name="note_versions")
    op.drop_table("note_versions")
    op.drop_index("uq_note_aliases_note_alias_lower", table_name="note_aliases")
    op.drop_index("ix_note_aliases_note_id", table_name="note_aliases")
    op.drop_index("ix_note_aliases_vault_alias_lower", table_name="note_aliases")
    op.drop_table("note_aliases")
