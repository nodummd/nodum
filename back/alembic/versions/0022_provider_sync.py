"""provider sync: connections, per-stream cursors, external-id -> note mapping

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "provider_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vault_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaults.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_account_id", sa.String(length=255), nullable=False),
        sa.Column("external_email", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("scopes", sa.Text(), nullable=False, server_default=""),
        sa.Column("access_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("refresh_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("error_class", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("disabled_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("settings", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("people_counts", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_run_stats", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "provider", "external_account_id", "vault_id", name="uq_provider_conn_account"),
    )
    op.create_index("ix_provider_connections_user", "provider_connections", ["user_id"])
    op.create_index("ix_provider_connections_vault", "provider_connections", ["vault_id"])
    # The dispatcher's hot query: "which active connections are due a poll?"
    op.create_index(
        "ix_provider_connections_due",
        "provider_connections",
        ["status", "disabled_until"],
    )

    op.create_table(
        "sync_streams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "connection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("provider_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stream", sa.String(length=128), nullable=False),
        sa.Column("cursor_token", sa.Text(), nullable=False, server_default=""),
        sa.Column("cursor_params", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("page_token", sa.Text(), nullable=False, server_default=""),
        sa.Column("backfill_cursor", sa.Text(), nullable=False, server_default=""),
        sa.Column("backfill_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("needs_full_resync", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("lease_owner", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("records_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("poll_interval_s", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("connection_id", "stream", name="uq_sync_stream"),
    )
    op.create_index("ix_sync_streams_connection", "sync_streams", ["connection_id"])

    op.create_table(
        "external_objects",
        sa.Column(
            "connection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("provider_connections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("stream", sa.String(length=128), primary_key=True),
        sa.Column("external_id", sa.String(length=512), primary_key=True),
        # SET NULL, not CASCADE: a user hand-deleting a synced note must leave
        # a tombstone the engine can read as "do not recreate this".
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("content_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("external_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_version", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_external_objects_note", "external_objects", ["note_id"])


def downgrade() -> None:
    op.drop_index("ix_external_objects_note", table_name="external_objects")
    op.drop_table("external_objects")
    op.drop_index("ix_sync_streams_connection", table_name="sync_streams")
    op.drop_table("sync_streams")
    op.drop_index("ix_provider_connections_due", table_name="provider_connections")
    op.drop_index("ix_provider_connections_vault", table_name="provider_connections")
    op.drop_index("ix_provider_connections_user", table_name="provider_connections")
    op.drop_table("provider_connections")
