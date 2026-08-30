"""The idempotent-apply path, against a real database.

`apply_record` is the riskiest code in the sync feature, and the only part
whose failures are both silent and destructive: a bug here means either a
duplicate note on every poll, or somebody's meeting notes overwritten. It also
cannot be meaningfully unit-tested — `ON CONFLICT`, `ON DELETE SET NULL` and
the row lock inside `transform_content` are Postgres behaviour, and a fake
would only assert the fake.

So this walks the whole lifecycle against real tables: create, redeliver,
update, tombstone, user-deletion, and an out-of-order page.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import async_session_factory
from app.models.providers import ExternalObject, ProviderConnection
from app.models.vaults import Note
from app.services import provider_sync_service, providers

STREAM = "calendar:events:primary"


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"sync-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Sync Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {
        "headers": headers,
        "vault_id": uuid.UUID(vaults[0]["id"]),
        "user_id": uuid.UUID(resp.json()["data"]["user"]["id"]),
    }


@pytest.fixture
async def connection(workspace: dict) -> ProviderConnection:
    """A connection row with no real grant — apply_record never needs a token."""
    async with async_session_factory() as session:
        row = ProviderConnection(
            user_id=workspace["user_id"],
            vault_id=workspace["vault_id"],
            provider="google_calendar",
            external_account_id=uuid.uuid4().hex,
            external_email="tester@example.com",
            connected_at=datetime.now(UTC),
            settings={},
            people_counts={},
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


def _record(external_id: str = "evt1", *, body: str = "# Design review\n\nfirst version\n", version: int = 0):
    return providers.SyncRecord(
        external_id=external_id,
        title="Design review",
        folder="Calendar/2026/09",
        body=body,
        external_updated_at=datetime.now(UTC),
        external_version=version,
    )


async def _apply(connection: ProviderConnection, record) -> str:
    async with async_session_factory() as session:
        fresh = await session.get(ProviderConnection, connection.id)
        assert fresh is not None
        return await provider_sync_service.apply_record(session, fresh, STREAM, record, people_counts={})


async def _mapping(connection: ProviderConnection, external_id: str = "evt1") -> ExternalObject | None:
    async with async_session_factory() as session:
        return await session.get(ExternalObject, (connection.id, STREAM, external_id))


@pytest.mark.asyncio
async def test_first_apply_creates_a_note_and_maps_it(connection: ProviderConnection) -> None:
    assert await _apply(connection, _record()) == "created"

    mapping = await _mapping(connection)
    assert mapping is not None and mapping.note_id is not None
    async with async_session_factory() as session:
        note = await session.get(Note, mapping.note_id)
    assert note is not None
    assert note.path == "Calendar/2026/09/Design review"
    # Every synced note carries the region marker, or there is nowhere for the
    # user to write and the note is a dead end.
    assert providers.USER_REGION_MARKER in note.content


@pytest.mark.asyncio
async def test_redelivering_the_same_record_writes_nothing(connection: ProviderConnection) -> None:
    """Overlapping windows re-deliver boundary records on purpose, so an
    unchanged record must be genuinely free — no write, no re-embed, no graph
    invalidation."""
    assert await _apply(connection, _record()) == "created"
    before = await _mapping(connection)
    assert before is not None
    stamp = before.updated_at

    for _ in range(3):
        assert await _apply(connection, _record()) == "unchanged"

    after = await _mapping(connection)
    assert after is not None
    assert after.updated_at == stamp, "an unchanged record still touched the row"

    async with async_session_factory() as session:
        count = len(
            (
                await session.execute(
                    select(Note).where(Note.vault_id == connection.vault_id, Note.title == "Design review")
                )
            )
            .scalars()
            .all()
        )
    assert count == 1, "redelivery duplicated the note"


@pytest.mark.asyncio
async def test_an_update_preserves_everything_below_the_marker(connection: ProviderConnection) -> None:
    """The unrecoverable failure. Someone takes meeting notes, the event moves,
    and the update must not take their writing with it."""
    assert await _apply(connection, _record()) == "created"
    mapping = await _mapping(connection)
    assert mapping is not None and mapping.note_id is not None

    # The user writes underneath, as they are meant to.
    async with async_session_factory() as session:
        note = await session.get(Note, mapping.note_id)
        assert note is not None
        sync_region, _ = providers.split_user_region(note.content)
        note.content = providers.compose(
            sync_region, f"{providers.USER_REGION_MARKER}\n\nAmara pushed back. Follow up Tuesday."
        )
        await session.commit()

    assert await _apply(connection, _record(body="# Design review\n\nrescheduled\n")) == "updated"

    async with async_session_factory() as session:
        note = await session.get(Note, mapping.note_id)
    assert note is not None
    assert "Amara pushed back. Follow up Tuesday." in note.content
    assert "rescheduled" in note.content
    assert "first version" not in note.content
    assert note.content.count(providers.USER_REGION_MARKER) == 1


@pytest.mark.asyncio
async def test_a_note_the_user_deleted_is_never_recreated(connection: ProviderConnection) -> None:
    """ON DELETE SET NULL leaves the mapping behind as a tombstone meaning
    "the user rejected this". Resurrecting it every five minutes is the most
    infuriating thing a sync engine can do."""
    assert await _apply(connection, _record()) == "created"
    mapping = await _mapping(connection)
    assert mapping is not None and mapping.note_id is not None

    async with async_session_factory() as session:
        note = await session.get(Note, mapping.note_id)
        await session.delete(note)
        await session.commit()

    orphaned = await _mapping(connection)
    assert orphaned is not None, "the mapping was cascaded away with the note"
    assert orphaned.note_id is None, "note_id should have been set to NULL, not cascaded"

    assert await _apply(connection, _record()) == "user_deleted"
    assert await _apply(connection, _record(body="# Design review\n\nchanged\n")) == "user_deleted"


@pytest.mark.asyncio
async def test_a_cancelled_event_keeps_the_note(connection: ProviderConnection) -> None:
    """A meeting being cancelled is not permission to destroy the notes taken
    in it."""
    assert await _apply(connection, _record()) == "created"
    mapping = await _mapping(connection)
    assert mapping is not None and mapping.note_id is not None

    tombstone = providers.SyncRecord(external_id="evt1", kind="tombstone")
    assert await _apply(connection, tombstone) == "tombstoned"

    after = await _mapping(connection)
    assert after is not None and after.deleted_at is not None
    async with async_session_factory() as session:
        note = await session.get(Note, mapping.note_id)
    assert note is not None, "the note was deleted along with the calendar event"


@pytest.mark.asyncio
async def test_a_late_page_cannot_clobber_a_newer_write(connection: ProviderConnection) -> None:
    """At-least-once delivery means pages can arrive out of order."""
    assert await _apply(connection, _record(body="v1\n", version=10)) == "created"
    assert await _apply(connection, _record(body="v2\n", version=20)) == "updated"
    assert await _apply(connection, _record(body="v-old\n", version=5)) == "stale"

    mapping = await _mapping(connection)
    assert mapping is not None and mapping.note_id is not None
    async with async_session_factory() as session:
        note = await session.get(Note, mapping.note_id)
    assert note is not None and "v2" in note.content
    assert "v-old" not in note.content


@pytest.mark.asyncio
async def test_two_records_do_not_collide_on_one_note(connection: ProviderConnection) -> None:
    """Two events with the same title are two notes, mapped separately."""
    assert await _apply(connection, _record("evt1")) == "created"
    assert await _apply(connection, _record("evt2")) == "created"

    first = await _mapping(connection, "evt1")
    second = await _mapping(connection, "evt2")
    assert first is not None and second is not None
    assert first.note_id != second.note_id


@pytest.mark.asyncio
async def test_a_run_that_dropped_records_does_not_report_health(
    connection: ProviderConnection,
) -> None:
    """The meta-bug: outcome counts were computed and discarded, and status was
    set to "active" unconditionally — so a run that failed to save every single
    record still showed "Up to date" with a fresh timestamp. That is the
    reassuring lie that let several real record-dropping bugs go unnoticed
    during development, and it is worth a test of its own."""

    class _AllFail:
        """An adapter whose records can never be created."""

        id = "google_calendar"
        name = "Google Calendar"
        scopes = ()

        def streams(self, settings):
            return [STREAM]

        def cursor_params(self, stream, settings):
            return {}

        async def fetch(self, ctx):
            # Over the 2 MB note ceiling, so create_note refuses it. A real
            # cause rather than a contrived one: a long mail thread with images
            # inlined as data URLs reaches this without trying.
            from app.constants.limits import MAX_NOTE_SIZE_BYTES

            return providers.SyncPage(
                records=[
                    providers.SyncRecord(
                        external_id="huge1",
                        title="Enormous thread",
                        folder="Mail/2026/08",
                        body="x" * (MAX_NOTE_SIZE_BYTES + 1024),
                    )
                ],
                done=True,
            )

    import app.services.provider_sync_service as engine

    original_adapter = providers.get_adapter
    original_token = engine.access_token_for
    providers.get_adapter = lambda _id: _AllFail()  # type: ignore[assignment]
    engine.access_token_for = lambda db, conn: _noop_token()  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            fresh = await session.get(ProviderConnection, connection.id)
            assert fresh is not None
            result = await engine.sync_connection(session, fresh)
    finally:
        providers.get_adapter = original_adapter  # type: ignore[assignment]
        engine.access_token_for = original_token  # type: ignore[assignment]

    assert result.success, "a record failure is not a connection failure"
    async with async_session_factory() as session:
        after = await session.get(ProviderConnection, connection.id)
    assert after is not None
    # The connection is healthy — auth worked, the cursor advanced — but the
    # run must not be reported as clean.
    assert after.status == "active"
    assert after.last_run_stats.get("error", 0) >= 1, "the failure was thrown away again"


async def _noop_token() -> str:
    return "token"


@pytest.mark.asyncio
async def test_deleting_a_vault_hands_the_google_grant_back(connection: ProviderConnection) -> None:
    """Closing an account or deleting a vault cascades the connection away —
    and with it the encrypted refresh token, after which nobody can revoke the
    grant. Left alone, someone who deleted their account keeps Nodum listed in
    their Google permissions with standing access to their mail, indefinitely,
    with no way to know and no way for us to withdraw it.

    So the revoke has to happen in the window *before* the row disappears.
    """
    from app.services import provider_connection_service
    from app.utils.crypto_utils import encrypt_secret

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        row.refresh_ciphertext = encrypt_secret("refresh-token-value", purpose="oauth")
        await session.commit()

    revoked: list[str] = []

    async def _capture(token: str) -> None:
        revoked.append(token)

    from app.services.providers import google_auth

    original = google_auth.revoke
    google_auth.revoke = _capture  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            count = await provider_connection_service.revoke_grants(session, vault_id=connection.vault_id)
    finally:
        google_auth.revoke = original  # type: ignore[assignment]

    assert count == 1
    assert revoked == ["refresh-token-value"], "the grant was not handed back to Google"
