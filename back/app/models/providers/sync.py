"""Provider sync — connections, per-stream cursors, and external-id mapping.

Three tables, and the split between them is load-bearing:

``ProviderConnection`` holds the OAuth grant. ``SyncStream`` holds one cursor
per logical stream, because a Google account has one Gmail history but *N*
calendars, each with its own independent sync token — putting the cursor on the
connection would force every calendar to resync whenever any one of them
faulted. ``ExternalObject`` maps a provider's id to the note it produced, and is
where idempotency lives.

Deliberately NOT reusing ``oauth_connections``: its unique constraint is
``(provider, provider_account_id)`` *globally*, so the same Google account could
never be both a sign-in identity and a data source, and two users could never
connect the same shared account. It also has no token columns, by design — it
records who you are, not what we may read on your behalf.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

#: Connection lifecycle. `needs_reauth` is terminal until the user acts;
#: `transient_broken` is retried with backoff.
#: Every status the engine actually assigns. Enforced by
#: `test_status_values_are_declared` — a tuple that merely documents intent
#: drifts from the code within two changes and then misleads.
#: "paused" is the one state a person chooses. The sweep's whitelist is
#: (active, transient_broken), so a paused connection is simply never due.
CONNECTION_STATUSES = ("active", "transient_broken", "needs_reauth", "key_unavailable", "paused")

#: Why a connection stopped. Kept separate from the message so the UI can react
#: to the *class* — `oauth_testing_mode` gets its own explanation, because the
#: generic "reconnect" advice does not fix it and the user will loop forever.
ERROR_CLASSES = (
    "",
    "auth",
    "rate_limit",
    "cursor_invalid",
    "provider_5xx",
    "oauth_testing_mode",
    "config",
    "not_found",
    "bug",
)


class ProviderConnection(UUIDMixin, TimestampMixin, Base):
    """One authorised data source, bound to one vault."""

    __tablename__ = "provider_connections"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Synced notes land in exactly one vault. Bound at connect time so a sync
    #: worker never has to guess, and so deleting the vault takes its synced
    #: notes and this connection with it.
    vault_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    external_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    #: Space-joined, exactly as *granted* — not as requested. A user can
    #: deselect a scope on the consent screen, and an adapter must check what
    #: it actually got rather than what it asked for.
    scopes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    access_ciphertext: Mapped[str] = mapped_column(Text, nullable=False, default="")
    refresh_ciphertext: Mapped[str] = mapped_column(Text, nullable=False, default="")
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    error_class: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    disabled_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: When the *grant* was made. Used to recognise the 7-day refresh-token
    #: expiry that a Google project left in "Testing" mode inflicts.
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    #: Per-connection user choices: folders, backfill window, whether to store
    #: message bodies, which calendars are enabled.
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    #: Outcome counts from the most recent run: created / updated /
    #: unchanged / error and so on. Persisted because the alternative is what
    #: this code did before — compute them, discard them, and unconditionally
    #: report "active", so a connection that failed to save every single record
    #: still showed "Up to date" with a fresh timestamp. That is the failure
    #: mode that hid several real bugs during development.
    last_run_stats: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)

    #: How many times each person has been seen across every sync run, so the
    #: People-note threshold means "three interactions ever" rather than
    #: "three in one page". Kept here rather than derived on demand because the
    #: alternative is aggregating every external_objects payload on every run.
    people_counts: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("user_id", "provider", "external_account_id", "vault_id", name="uq_provider_conn_account"),
        # The dispatcher's hot query, run every tick: "which active connections
        # are due a poll?" Declared here rather than only in the migration —
        # `--autogenerate` proposes dropping any index the models do not know
        # about, and losing this one degrades the sweep silently, getting worse
        # as connections are added.
        Index("ix_provider_connections_due", "status", "disabled_until"),
    )


class SyncStream(UUIDMixin, TimestampMixin, Base):
    """One cursor and one lease per logical stream of a connection."""

    __tablename__ = "sync_streams"

    connection_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("provider_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    #: 'gmail:messages' | 'calendar:events:<calendar_id>'
    stream: Mapped[str] = mapped_column(String(128), nullable=False)

    #: The provider's opaque incremental token — Gmail historyId, Calendar
    #: nextSyncToken. Advanced only after the page's writes are committed.
    cursor_token: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: The query parameters the token was minted under, frozen. Google
    #: invalidates a Calendar syncToken if singleEvents or eventTypes change
    #: between calls — and does so *silently*, returning a plausible partial
    #: result. Comparing this on every run turns invisible data loss into a
    #: deliberate resync.
    cursor_params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: Mid-pagination resume point. A separate column from `cursor_token` on
    #: purpose: the two are different types of token and storing a pageToken
    #: where a syncToken belongs skips every record after it, silently.
    page_token: Mapped[str] = mapped_column(Text, nullable=False, default="")

    backfill_done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    needs_full_resync: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    #: Cooperative lease rather than a Postgres advisory lock: the sync commits
    #: once per page, and an advisory lock releases at COMMIT. A lease column
    #: survives per-page commits, self-expires if the worker dies, and can be
    #: inspected with a plain SELECT when something is stuck.
    lease_owner: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Records seen on this stream, cumulative. Shown during a backfill so the
    #: UI can say "412 events so far" rather than an indefinite spinner.
    #: Deliberately a count and not a percentage: neither Gmail nor Calendar
    #: tells us the total, so a progress bar would be an invention.
    records_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    poll_interval_s: Mapped[int] = mapped_column(Integer, nullable=False, default=300)

    __table_args__ = (UniqueConstraint("connection_id", "stream", name="uq_sync_stream"),)


class ExternalObject(TimestampMixin, Base):
    """Provider record → note, and the idempotency key for the whole engine."""

    __tablename__ = "external_objects"

    connection_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("provider_connections.id", ondelete="CASCADE"),
        primary_key=True,
    )
    stream: Mapped[str] = mapped_column(String(128), primary_key=True)
    external_id: Mapped[str] = mapped_column(String(512), primary_key=True)

    #: ON DELETE SET NULL, deliberately. If a user deletes a synced note by
    #: hand, this row survives with note_id NULL and the engine reads that as
    #: "the user rejected this" and never recreates it. Without that, every
    #: poll resurrects the note the user just deleted — the single most
    #: infuriating failure mode a sync engine has.
    note_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("notes.id", ondelete="SET NULL"), nullable=True
    )
    #: sha256 of the rendered body. Suppresses no-op writes, which matters
    #: because overlapping windows re-deliver boundary records every run and an
    #: unconditional write would re-embed and re-invalidate the graph each time.
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    external_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Monotonic version from the provider where one exists (Gmail historyId),
    #: so a late-arriving page cannot clobber a newer write.
    external_version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_external_objects_note", "note_id"),)
