"""The sync engine: turns adapter pages into notes, exactly once.

Adapters fetch and render; this decides what happens to the database. Keeping
that split means the three things that are easy to get catastrophically wrong —
cursor ordering, idempotency, and not overwriting what the user wrote — are
implemented once here rather than re-implemented, differently, in every
adapter.

## Ordering, and why it is this way round

Per page: apply every record (each committing as `note_service` does), and only
then advance the cursor in its own commit. A crash anywhere in that sequence
leaves the cursor where it was, so the page replays — and replay is free,
because `ExternalObject.content_hash` makes an unchanged record a no-op with no
write, no re-embed and no graph invalidation.

The inverse order — advance the cursor, then write — loses records silently and
forever. There is no error, no log line, and no way to notice until someone
goes looking for a note that was never created.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.logging import get_logger
from app.models.providers import ExternalObject, ProviderConnection, SyncStream
from app.models.vaults import Note, Vault
from app.services import folder_service, note_service, providers
from app.services.importers.base import safe_segment
from app.services.providers import base as provider_base
from app.services.providers import google_auth
from app.services.service_response import ServiceResponse
from app.settings import get_settings
from app.utils.crypto_utils import decrypt_secret, encrypt_secret

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


logger = get_logger("provider_sync")

#: A lease is held for this long and heartbeated per page. Long enough that a
#: slow page cannot lose it mid-flight, short enough that a worker killed
#: mid-run frees the stream within a poll cycle or two.
LEASE_SECONDS = 600
#: Pages per invocation. Bounds one task's runtime under the Celery soft limit
#: while letting a backfill make real progress; the stream is simply picked up
#: again on the next tick.
MAX_PAGES_PER_RUN = 8
#: Backoff schedule for transient failures, in seconds.
_BACKOFF = (60, 300, 900, 3600, 21600)
#: A person must appear this many times before they get their own note. Below
#: it their name is plain text. Without a threshold, one note per unique sender
#: turns the graph into thousands of ghost nodes and destroys the thing the
#: user came here for.
DEFAULT_PEOPLE_THRESHOLD = 3
#: Cap on the persisted interaction tally, so a busy mailbox cannot grow one
#: JSONB column without bound.
_MAX_TRACKED_PEOPLE = 500


# ── tokens ──────────────────────────────────────────────────────────────────


async def access_token_for(db: AsyncSession, connection: ProviderConnection) -> str:
    """A live access token, refreshing if needed.

    Raises ProviderError with an `auth` class when the grant is dead, which the
    caller turns into `needs_reauth` — there is no point retrying a revoked
    token every five minutes forever.
    """
    now = datetime.now(UTC)
    if connection.access_ciphertext and connection.access_expires_at:
        expires = connection.access_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        if expires > now:
            token = decrypt_secret(connection.access_ciphertext, purpose="oauth")
            if token:
                return token

    refresh = decrypt_secret(connection.refresh_ciphertext, purpose="oauth")
    if not refresh:
        # Unreadable ciphertext means the encryption key changed. Say so
        # precisely: "reconnect" is the fix, but the cause is operational and
        # the operator needs to know it was not the user's doing.
        raise provider_base.ProviderError(
            "Stored credentials could not be decrypted — the server's encryption key has changed.",
            error_class="config",
        )

    payload = await google_auth.refresh_access_token(refresh)
    token = str(payload.get("access_token") or "")
    if not token:
        raise provider_base.ProviderError("Google returned no access token.", error_class="auth")

    connection.access_ciphertext = encrypt_secret(token, purpose="oauth")
    connection.access_expires_at = google_auth.expires_at(payload)
    # Google rotates refresh tokens occasionally; persisting the new one is not
    # optional, or the next refresh fails with the old one.
    if payload.get("refresh_token"):
        connection.refresh_ciphertext = encrypt_secret(str(payload["refresh_token"]), purpose="oauth")
    await db.commit()
    return token


# ── streams ─────────────────────────────────────────────────────────────────


async def ensure_streams(db: AsyncSession, connection: ProviderConnection) -> list[SyncStream]:
    """Create any missing stream rows for a connection's adapter."""
    adapter = providers.get_adapter(connection.provider)
    if adapter is None:
        return []

    wanted = adapter.streams(connection.settings or {})
    existing = {
        s.stream: s
        for s in (await db.execute(select(SyncStream).where(SyncStream.connection_id == connection.id))).scalars()
    }
    out: list[SyncStream] = []
    for name in wanted:
        stream = existing.get(name)
        if stream is None:
            stream = SyncStream(
                connection_id=connection.id,
                stream=name,
                poll_interval_s=get_settings().PROVIDER_SYNC_DEFAULT_INTERVAL,
            )
            db.add(stream)
        out.append(stream)
    await db.commit()
    return out


async def claim_stream(db: AsyncSession, stream_id: UUID, owner: str) -> bool:
    """Take the lease if it is free or expired. Returns False if someone holds it.

    A conditional UPDATE rather than an advisory lock: the run commits once per
    page, and an advisory lock would release at the first of those commits.
    """
    now = datetime.now(UTC)
    result = await db.execute(
        update(SyncStream)
        .where(
            SyncStream.id == stream_id,
            (SyncStream.lease_expires_at.is_(None)) | (SyncStream.lease_expires_at < now),
        )
        .values(lease_owner=owner, lease_expires_at=now + timedelta(seconds=LEASE_SECONDS), last_run_at=now)
    )
    await db.commit()
    return bool(result.rowcount)


async def release_stream(db: AsyncSession, stream_id: UUID) -> None:
    await db.execute(update(SyncStream).where(SyncStream.id == stream_id).values(lease_owner="", lease_expires_at=None))
    await db.commit()


# ── applying records ────────────────────────────────────────────────────────


def _folder_root(connection: ProviderConnection, adapter_id: str) -> str:
    return str((connection.settings or {}).get("folder_root") or "").strip("/")


async def _person_note(db: AsyncSession, connection: ProviderConnection, name: str, counts: dict[str, int]) -> bool:
    """Create a People note once someone crosses the threshold.

    Returns True when a link to `name` may be emitted. The threshold exists
    because a link whose target does not exist becomes a ghost node, and one
    ghost per unique correspondent is exactly how a graph stops being readable.
    """
    threshold = int((connection.settings or {}).get("people_threshold") or DEFAULT_PEOPLE_THRESHOLD)
    if counts.get(name, 0) < threshold:
        return False

    safe_name = safe_segment(name, fallback="")
    if not safe_name:
        return False
    path = f"People/{safe_name}"
    existing = await db.scalar(select(Note.id).where(Note.vault_id == connection.vault_id, Note.path == path))
    if existing is not None:
        return True

    folder = await folder_service.ensure_folder_path(db, connection.vault_id, connection.user_id, "People")
    response = await note_service.create_note(
        db,
        connection.vault_id,
        connection.user_id,
        title=safe_name,
        folder_id=folder.data if folder.success else None,
        content=f"---\nsource: {connection.provider}\ntype: person\n---\n\n# {name}\n",
    )
    return response.success


async def apply_record(
    db: AsyncSession,
    connection: ProviderConnection,
    stream: str,
    record: providers.SyncRecord,
    *,
    people_counts: dict[str, int],
) -> str:
    """Create, update, skip or tombstone one record. Returns what happened."""
    mapping = await db.get(ExternalObject, (connection.id, stream, record.external_id))

    if record.kind == "tombstone":
        if mapping and mapping.note_id:
            # Soft: mark it, do not delete the note. A calendar event being
            # cancelled is not permission to destroy the notes someone took
            # in it.
            mapping.deleted_at = datetime.now(UTC)
            await db.commit()
            return "tombstoned"
        return "skipped"

    # A mapping whose note_id was nulled means the user deleted the note by
    # hand. Recreating it on the next poll is the single most infuriating thing
    # a sync engine can do, so this is where we do not.
    if mapping is not None and mapping.note_id is None:
        return "user_deleted"

    body = record.body
    for name in record.wants_notes:
        if await _person_note(db, connection, name, people_counts):
            # Only link a person who now has a note. Earlier plain-text
            # mentions stay plain — retro-linking them would mean rewriting
            # notes the user may since have edited.
            body = body.replace(f"With {name}", f"With [[{name}]]").replace(f", {name}", f", [[{name}]]")

    content_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()

    if mapping is not None and mapping.note_id is not None:
        if mapping.content_hash == content_hash:
            return "unchanged"
        if record.external_version and record.external_version < mapping.external_version:
            # A late page must not clobber a newer write.
            return "stale"

        # transform_content holds the note's row lock across the callback, so a
        # person typing under "## Notes" at this exact moment cannot lose it.
        response = await note_service.transform_content(
            db,
            connection.vault_id,
            connection.user_id,
            mapping.note_id,
            lambda current: providers.merge_into(current, body),
        )
        if not response.success:
            return "error"
        await _record_mapping(db, connection, stream, record, mapping.note_id, content_hash)
        return "updated"

    root = _folder_root(connection, connection.provider)
    folder_path = f"{root}/{record.folder}" if root else record.folder
    folder = await folder_service.ensure_folder_path(db, connection.vault_id, connection.user_id, folder_path)
    created = await note_service.create_note(
        db,
        connection.vault_id,
        connection.user_id,
        title=record.title or record.external_id,
        folder_id=folder.data if folder.success else None,
        content=providers.compose(body, ""),
    )
    if not created.success or created.data is None:
        # Logged rather than swallowed: without this a record that can never be
        # created is retried on every poll, forever, with nothing anywhere
        # saying why.
        logger.warning(
            "record_create_failed",
            connection=str(connection.id),
            stream=stream,
            external_id=record.external_id,
            title=record.title,
            reason=created.message or created.error_code,
        )
        return "error"
    await _record_mapping(db, connection, stream, record, created.data.id, content_hash)
    return "created"


async def _record_mapping(
    db: AsyncSession,
    connection: ProviderConnection,
    stream: str,
    record: providers.SyncRecord,
    note_id: UUID,
    content_hash: str,
) -> None:
    """Upsert the idempotency row.

    The `WHERE` guard makes redelivery a no-op and stops an out-of-order page
    from overwriting a newer version — the two properties that let the engine
    be at-least-once instead of needing exactly-once delivery it cannot have.
    """
    stmt = pg_insert(ExternalObject).values(
        connection_id=connection.id,
        stream=stream,
        external_id=record.external_id,
        note_id=note_id,
        content_hash=content_hash,
        external_updated_at=record.external_updated_at,
        external_version=record.external_version,
        payload=record.payload,
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["connection_id", "stream", "external_id"],
            set_={
                "note_id": stmt.excluded.note_id,
                "content_hash": stmt.excluded.content_hash,
                "external_updated_at": stmt.excluded.external_updated_at,
                "external_version": stmt.excluded.external_version,
                "payload": stmt.excluded.payload,
                "deleted_at": None,
            },
            where=ExternalObject.external_version <= stmt.excluded.external_version,
        )
    )
    await db.commit()


# ── the run loop ────────────────────────────────────────────────────────────


async def run_stream(db: AsyncSession, connection: ProviderConnection, stream: SyncStream) -> dict[str, Any]:
    """Walk one stream for up to MAX_PAGES_PER_RUN pages."""
    adapter = providers.get_adapter(connection.provider)
    if adapter is None:
        return {"skipped": "adapter unavailable"}

    vault = await db.get(Vault, connection.vault_id)
    daily_format = str(((vault.settings or {}) if vault else {}).get("daily_note_format") or "YYYY-MM-DD")

    token = await access_token_for(db, connection)
    # Seeded from what previous runs saw. Counting only within a run made the
    # threshold mean "three appearances in one page", which an incremental
    # sync of two events can never reach — so the People notes that carry most
    # of this feature's graph value were never created after the first
    # backfill, silently.
    counts: dict[str, int] = dict(connection.people_counts or {})
    stats: dict[str, int] = {}
    pages = 0

    # A cursor is only meaningful for the query it was minted under. Google
    # invalidates a Calendar syncToken when singleEvents or eventTypes change
    # and says nothing about it, so a mismatch here becomes a deliberate
    # resync rather than a silently truncated result.
    wanted_params = adapter.cursor_params(stream.stream, connection.settings or {})
    if stream.cursor_token and stream.cursor_params and stream.cursor_params != wanted_params:
        logger.info("cursor_params_changed", stream=stream.stream, connection=str(connection.id))
        stream.needs_full_resync = True

    if stream.needs_full_resync:
        stream.cursor_token = ""
        stream.page_token = ""
        stream.needs_full_resync = False
        await db.commit()

    while pages < MAX_PAGES_PER_RUN:
        ctx = providers.FetchContext(
            access_token=token,
            stream=stream.stream,
            cursor_token=stream.cursor_token,
            page_token=stream.page_token,
            cursor_params=stream.cursor_params or {},
            settings=connection.settings or {},
            backfill=not stream.backfill_done,
            daily_format=daily_format,
        )
        page = await adapter.fetch(ctx)
        pages += 1

        for record in page.records:
            for name in record.wants_notes:
                counts[name] = counts.get(name, 0) + 1

        for record in page.records:
            outcome = await apply_record(db, connection, stream.stream, record, people_counts=counts)
            stats[outcome] = stats.get(outcome, 0) + 1

        # Bounded: a large mailbox would otherwise grow this JSONB without
        # limit. The people who matter are the frequent ones, and anyone
        # trimmed is below the threshold by definition.
        if len(counts) > _MAX_TRACKED_PEOPLE:
            counts = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:_MAX_TRACKED_PEOPLE])
        connection.people_counts = counts

        # Records are committed. Only now may the cursor move.
        stream.page_token = page.next_page_token
        if page.done:
            if page.next_cursor:
                stream.cursor_token = page.next_cursor
                stream.cursor_params = wanted_params
            stream.backfill_done = True
            stream.last_success_at = datetime.now(UTC)
        # Heartbeat the lease so a long backfill does not have it expire
        # underneath it and invite a second worker in.
        stream.lease_expires_at = datetime.now(UTC) + timedelta(seconds=LEASE_SECONDS)
        await db.commit()

        if page.done:
            break

    return {"pages": pages, **stats}


async def sync_connection(db: AsyncSession, connection: ProviderConnection) -> ServiceResponse[dict[str, Any]]:
    """Run every stream of one connection, and maintain its health state."""
    owner = uuid4().hex
    totals: dict[str, Any] = {"streams": 0}

    try:
        streams = await ensure_streams(db, connection)
        for stream in streams:
            if not await claim_stream(db, stream.id, owner):
                continue
            try:
                result = await run_stream(db, connection, stream)
                totals["streams"] = int(totals["streams"]) + 1
                for key, value in result.items():
                    if isinstance(value, int):
                        totals[key] = int(totals.get(key, 0)) + value
            finally:
                await release_stream(db, stream.id)

    except providers.CursorInvalid as exc:
        # Expected, not exceptional: the provider aged our token out. Mark for
        # a full walk and report success — the next tick does the work.
        await db.execute(
            update(SyncStream)
            .where(SyncStream.connection_id == connection.id)
            .values(needs_full_resync=True, cursor_token="", page_token="")
        )
        connection.last_error = str(exc)
        connection.error_class = "cursor_invalid"
        await db.commit()
        return ServiceResponse.ok({"resync_scheduled": True})

    except provider_base.ProviderError as exc:
        await _record_failure(db, connection, exc)
        return ServiceResponse.fail(exc.error_class or "bug", str(exc))

    except Exception as exc:
        logger.exception("sync_failed", connection=str(connection.id))
        await _record_failure(db, connection, provider_base.ProviderError(str(exc), error_class="bug"))
        return ServiceResponse.fail("bug", "Sync failed unexpectedly.")

    connection.status = "active"
    connection.error_class = ""
    connection.last_error = ""
    connection.consecutive_failures = 0
    connection.disabled_until = None
    await db.commit()
    return ServiceResponse.ok(totals)


async def _record_failure(db: AsyncSession, connection: ProviderConnection, exc: provider_base.ProviderError) -> None:
    """Advance the connection's health state and schedule the next attempt."""
    error_class = exc.error_class
    message = str(exc)

    if error_class == "auth":
        error_class, message = google_auth.classify_refresh_failure(message, connected_at=connection.connected_at)
        # A revoked or expired grant will not fix itself. Stop retrying and put
        # a reconnect button in front of the user instead.
        connection.status = "needs_reauth"
        connection.disabled_until = None
    elif error_class == "config":
        connection.status = "key_unavailable"
        connection.disabled_until = None
    else:
        connection.status = "transient_broken"
        index = min(connection.consecutive_failures, len(_BACKOFF) - 1)
        delay = exc.retry_after or _BACKOFF[index]
        connection.disabled_until = datetime.now(UTC) + timedelta(seconds=delay)

    connection.error_class = error_class
    connection.last_error = message[:2000]
    connection.consecutive_failures += 1
    await db.commit()


async def due_connections(db: AsyncSession, limit: int = 50) -> list[ProviderConnection]:
    """Connections the scheduler should run now."""
    now = datetime.now(UTC)
    rows = await db.execute(
        select(ProviderConnection)
        .where(
            ProviderConnection.status.in_(("active", "transient_broken")),
            (ProviderConnection.disabled_until.is_(None)) | (ProviderConnection.disabled_until <= now),
        )
        .order_by(ProviderConnection.updated_at)
        .limit(limit)
    )
    return list(rows.scalars())
