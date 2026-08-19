"""email_verifications gains a purpose (signup / password reset / account delete)

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing rows are all signup codes, hence the default; it stays as a
    # server_default so a code row can never be written without a purpose.
    op.add_column(
        "email_verifications",
        sa.Column("purpose", sa.String(length=32), server_default="signup", nullable=False),
    )
    # Every lookup is "the pending code for this user and this purpose" — a
    # password reset must not consume the signup code, or vice versa.
    op.create_index(
        "ix_email_verifications_user_purpose",
        "email_verifications",
        ["user_id", "purpose"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_verifications_user_purpose", table_name="email_verifications")
    op.drop_column("email_verifications", "purpose")
