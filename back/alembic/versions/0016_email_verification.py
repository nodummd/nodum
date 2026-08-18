"""email_verifications (one-time signup codes)

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        # HMAC of the code, never the code — see models/auth/verification.py.
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_via", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_verifications_user", "email_verifications", ["user_id"])

    # Everyone who signed up before verification existed keeps their account.
    # Without this, turning the feature on in production locks out every
    # existing user at their next login — they would be asked to confirm an
    # address against a code that was never sent.
    op.execute("UPDATE users SET email_verified = true WHERE email_verified = false")


def downgrade() -> None:
    op.drop_index("ix_email_verifications_user", table_name="email_verifications")
    op.drop_table("email_verifications")
