"""Connection lifecycle: connect, inspect, reconfigure, disconnect.

Separated from `provider_sync_service` because the two have different
audiences. This one answers to a person clicking buttons and must never leak a
token or another user's row; that one answers to a scheduler and must be
correct about cursors. Mixing them would put ownership checks in the hot loop
and cursor logic in the request path.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import delete, select

from app.core.logging import get_logger
from app.models.providers import ExternalObject, ProviderConnection, SyncStream
from app.services import providers
from app.services.providers import base as provider_base
from app.services.providers import google_auth, google_calendar
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault
from app.utils.crypto_utils import decrypt_secret, encrypt_secret, encryption_available

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


logger = get_logger("provider_connections")


def _public(connection: ProviderConnection, streams: list[SyncStream]) -> dict[str, Any]:
    """The shape the UI gets. Tokens never appear here, in any form."""
    adapter = providers.get_adapter(connection.provider)
    last_success = max((s.last_success_at for s in streams if s.last_success_at), default=None)
    return {
        "id": str(connection.id),
        "provider": connection.provider,
        "provider_name": adapter.name if adapter else connection.provider,
        "vault_id": str(connection.vault_id),
        "email": connection.external_email,
        "status": connection.status,
        "error_class": connection.error_class,
        "last_error": connection.last_error,
        "connected_at": connection.connected_at.isoformat() if connection.connected_at else None,
        "last_success_at": last_success.isoformat() if last_success else None,
        "settings": connection.settings or {},
        "last_run": connection.last_run_stats or {},
        # Pulled out rather than left for the client to find: a partly-failing
        # sync must be visible without the UI having to know the shape of the
        # stats blob.
        "failed_records": int((connection.last_run_stats or {}).get("error", 0)),
        "streams": [
            {
                "stream": s.stream,
                "backfill_done": s.backfill_done,
                "records_seen": s.records_seen or 0,
                "last_success_at": s.last_success_at.isoformat() if s.last_success_at else None,
                "syncing": bool(s.lease_expires_at and s.lease_expires_at > datetime.now(UTC)),
            }
            for s in streams
        ],
    }


async def _owned(db: AsyncSession, connection_id: UUID, user_id: UUID) -> ProviderConnection | None:
    """Ownership check before anything else, on every path."""
    return await db.scalar(
        select(ProviderConnection).where(ProviderConnection.id == connection_id, ProviderConnection.user_id == user_id)
    )


async def list_for_user(db: AsyncSession, user_id: UUID) -> ServiceResponse[list[dict[str, Any]]]:
    connections = list(
        (
            await db.execute(
                select(ProviderConnection)
                .where(ProviderConnection.user_id == user_id)
                .order_by(ProviderConnection.created_at)
            )
        ).scalars()
    )
    out: list[dict[str, Any]] = []
    for connection in connections:
        streams = list(
            (await db.execute(select(SyncStream).where(SyncStream.connection_id == connection.id))).scalars()
        )
        out.append(_public(connection, streams))
    return ServiceResponse.ok(out)


async def complete_google_connect(
    db: AsyncSession, *, user_id: UUID, vault_id: UUID, code: str
) -> ServiceResponse[dict[str, Any]]:
    """Exchange the code and store the grant.

    Refuses rather than half-succeeds. A connection without a refresh token
    cannot sync in the background, and storing one anyway produces a feature
    that works until the access token expires an hour later.
    """
    if not encryption_available("oauth"):
        return ServiceResponse.fail(
            "validation_failed",
            "This server has no encryption key configured, so OAuth tokens cannot be stored "
            "safely. Set OAUTH_ENCRYPTION_KEY (or AI_ENCRYPTION_KEY) and try again.",
        )
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")

    try:
        tokens = await google_auth.exchange_code(code)
        profile = await google_auth.fetch_userinfo(str(tokens.get("access_token") or ""))
    except provider_base.ProviderError as exc:
        return ServiceResponse.fail("validation_failed", str(exc))
    except Exception:  # pragma: no cover - belt and braces on a redirect target
        # This runs inside a top-level browser redirect. Anything escaping here
        # is a raw 500 page rather than a handled error, so nothing is allowed
        # to escape, including whatever a future refactor introduces.
        logger.exception("google_connect_crashed")
        return ServiceResponse.fail("validation_failed", "Could not complete the connection.")

    granted = str(tokens.get("scope") or "")
    # Which adapter this grant is for is decided by what Google actually
    # granted, not by what we asked for — a user can untick a scope on the
    # consent screen, and connecting them to an adapter they did not authorise
    # would fail on the first poll with a confusing 403.
    provider_id = _provider_for_scopes(granted)
    if provider_id is None:
        return ServiceResponse.fail(
            "validation_failed",
            "No usable permissions were granted. Connect again and leave the requested permissions ticked.",
        )

    account_id = str(profile.get("sub") or "")
    email = str(profile.get("email") or "")
    existing = await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.user_id == user_id,
            ProviderConnection.provider == provider_id,
            ProviderConnection.external_account_id == account_id,
            ProviderConnection.vault_id == vault_id,
        )
    )

    connection = existing or ProviderConnection(
        user_id=user_id,
        vault_id=vault_id,
        provider=provider_id,
        external_account_id=account_id,
        settings={},
    )
    connection.external_email = email
    connection.scopes = granted
    connection.access_ciphertext = encrypt_secret(str(tokens["access_token"]), purpose="oauth")
    connection.refresh_ciphertext = encrypt_secret(str(tokens["refresh_token"]), purpose="oauth")
    connection.access_expires_at = google_auth.expires_at(tokens)
    connection.status = "active"
    connection.error_class = ""
    connection.last_error = ""
    connection.consecutive_failures = 0
    connection.disabled_until = None
    # Reset on every (re)connect: the 7-day Testing-mode detector measures from
    # the moment consent was actually given, and a reconnect is a new grant.
    connection.connected_at = datetime.now(UTC)
    if existing is None:
        db.add(connection)
    await db.commit()

    # Best-effort: pre-populate the calendar list so the settings UI has
    # something to show before the first sync runs.
    if provider_id == "google_calendar":
        try:
            calendars = await google_calendar.list_calendars(str(tokens["access_token"]))
            primary = next((c["id"] for c in calendars if c["primary"]), None)
            connection.settings = {
                **(connection.settings or {}),
                "available_calendars": calendars,
                "calendar": {"calendar_ids": [primary or "primary"]},
            }
            await db.commit()
        except provider_base.ProviderError as exc:
            logger.warning("calendar_list_failed", error=str(exc))

    logger.info("provider_connected", provider=provider_id, user=str(user_id))
    return ServiceResponse.ok({"id": str(connection.id), "provider": provider_id})


def _provider_for_scopes(granted: str) -> str | None:
    """Pick the adapter whose scopes are all present in the grant."""
    tokens = set(granted.split())
    for adapter in providers.available_adapters():
        if set(adapter.scopes).issubset(tokens):
            return str(adapter.id)
    return None


async def sync_now(db: AsyncSession, connection_id: UUID, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    connection = await _owned(db, connection_id, user_id)
    if connection is None:
        return ServiceResponse.fail("not_found", "Connection not found.")
    if connection.status == "needs_reauth":
        return ServiceResponse.fail("validation_failed", connection.last_error or "Reconnect required.")

    # Clear any backoff — the user asking directly overrides the schedule.
    connection.disabled_until = None
    await db.commit()

    # Handed to a worker rather than run here. See tasks.sync_connection for
    # why: a backfill inside a request holds a web worker for minutes and ends
    # in a timeout the user reads as failure.
    from app.core.celery import celery_app

    try:
        celery_app.send_task("tasks.sync_connection", args=[str(connection.id)])
    except Exception:
        # The broker being unreachable is an operator problem, and saying so is
        # better than a button that reports success and does nothing. Sync
        # needs a worker at all times anyway — this is not a new dependency.
        logger.exception("sync_enqueue_failed", connection=str(connection.id))
        return ServiceResponse.fail(
            "validation_failed",
            "Could not start the sync — the background worker is not reachable. "
            "Check that the Celery worker is running.",
        )
    return ServiceResponse.ok({"queued": True})


async def update_settings(
    db: AsyncSession, connection_id: UUID, user_id: UUID, patch: dict[str, Any]
) -> ServiceResponse[dict[str, Any]]:
    connection = await _owned(db, connection_id, user_id)
    if connection is None:
        return ServiceResponse.fail("not_found", "Connection not found.")

    # Only the keys a user is allowed to set. A settings blob written straight
    # from a request body is an injection surface into the sync engine.
    allowed = {"calendar", "gmail", "folder_root", "people_threshold"}
    merged = dict(connection.settings or {})
    for key, value in patch.items():
        if key in allowed:
            merged[key] = value
    connection.settings = merged
    await db.commit()

    # Changing which calendars or labels are in scope changes what the cursor
    # means, so let the engine reconcile streams on its next run.
    from app.services import provider_sync_service

    await provider_sync_service.ensure_streams(db, connection)
    streams = list((await db.execute(select(SyncStream).where(SyncStream.connection_id == connection.id))).scalars())
    return ServiceResponse.ok(_public(connection, streams))


async def revoke_grants(db: AsyncSession, *, user_id: UUID | None = None, vault_id: UUID | None = None) -> int:
    """Revoke every Google grant matching the filter, before its rows vanish.

    Called on account and vault deletion. Without it, deleting an account
    cascades the connection row away while leaving Nodum listed in the
    person's Google permissions with a live refresh token — and because the
    ciphertext went with the row, nothing can ever revoke it afterwards. They
    closed their account expecting everything gone; instead they are left with
    a standing permission to read their mail that they do not know about and
    we can no longer withdraw.

    Best-effort per connection: one unreachable revoke endpoint must not block
    a deletion the user has already confirmed.
    """
    query = select(ProviderConnection)
    if user_id is not None:
        query = query.where(ProviderConnection.user_id == user_id)
    if vault_id is not None:
        query = query.where(ProviderConnection.vault_id == vault_id)

    revoked = 0
    for connection in (await db.execute(query)).scalars():
        token = decrypt_secret(connection.refresh_ciphertext, purpose="oauth")
        if not token:
            continue
        await google_auth.revoke(token)
        revoked += 1
    if revoked:
        logger.info("provider_grants_revoked", count=revoked, user=str(user_id or ""), vault=str(vault_id or ""))
    return revoked


async def disconnect(db: AsyncSession, connection_id: UUID, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """Revoke upstream, then delete the grant. Synced notes are left alone.

    Deleting the notes would be the wrong default by a wide margin: they are in
    the user's vault, they may have been edited, and they may have writing
    underneath the sync region that exists nowhere else.
    """
    connection = await _owned(db, connection_id, user_id)
    if connection is None:
        return ServiceResponse.fail("not_found", "Connection not found.")

    refresh = decrypt_secret(connection.refresh_ciphertext, purpose="oauth")
    if refresh:
        await google_auth.revoke(refresh)

    await db.execute(delete(ExternalObject).where(ExternalObject.connection_id == connection.id))
    await db.execute(delete(SyncStream).where(SyncStream.connection_id == connection.id))
    await db.delete(connection)
    await db.commit()
    logger.info("provider_disconnected", provider=connection.provider, user=str(user_id))
    return ServiceResponse.ok({"disconnected": str(connection_id)})
