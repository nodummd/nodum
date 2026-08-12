"""functional indexes for link resolution

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-12

Link resolution filters on lower(title)/lower(path) (link_service
_resolve_targets, resolve_links_for_new_note) — without expression indexes
every save containing links scans the vault's notes.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE INDEX ix_notes_vault_lower_title ON notes (vault_id, lower(title))")
    op.execute("CREATE INDEX ix_notes_vault_lower_path ON notes (vault_id, lower(path))")


def downgrade() -> None:
    op.execute("DROP INDEX ix_notes_vault_lower_title")
    op.execute("DROP INDEX ix_notes_vault_lower_path")
