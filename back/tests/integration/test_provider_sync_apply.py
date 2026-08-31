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
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import async_session_factory
from app.models.providers import ExternalObject, ProviderConnection, SyncStream
from app.models.vaults import Note
from app.services import note_service, provider_sync_service, providers

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


async def _is_due(session, connection: ProviderConnection) -> bool:
    """Whether the scheduler would pick this connection up right now."""
    due = await provider_sync_service.due_connections(session, limit=10_000)
    return any(c.id == connection.id for c in due)


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


@pytest.mark.asyncio
async def test_manual_sync_is_queued_rather_than_run_in_the_request(
    connection: ProviderConnection,
) -> None:
    """A first backfill walks up to eight pages of 250 events, each computing
    an embedding. Run inline it holds a web worker for minutes and ends in a
    client timeout the user reads as failure — and then presses again."""
    from app.core import celery as celery_module
    from app.services import provider_connection_service

    sent: list[tuple[str, list[str]]] = []
    original = celery_module.celery_app.send_task
    celery_module.celery_app.send_task = lambda name, args=None, **kw: sent.append((name, args or []))  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            response = await provider_connection_service.sync_now(session, connection.id, connection.user_id)
    finally:
        celery_module.celery_app.send_task = original  # type: ignore[assignment]

    assert response.success
    assert response.data == {"queued": True}
    assert sent == [("tasks.sync_connection", [str(connection.id)])]


@pytest.mark.asyncio
async def test_an_unreachable_broker_is_reported_not_swallowed(
    connection: ProviderConnection,
) -> None:
    """A button that reports success and does nothing is worse than an error."""
    from app.core import celery as celery_module
    from app.services import provider_connection_service

    def _boom(*args: object, **kwargs: object) -> None:
        raise OSError("broker unreachable")

    original = celery_module.celery_app.send_task
    celery_module.celery_app.send_task = _boom  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            response = await provider_connection_service.sync_now(session, connection.id, connection.user_id)
    finally:
        celery_module.celery_app.send_task = original  # type: ignore[assignment]

    assert not response.success
    assert "worker" in response.message.lower()


@pytest.mark.asyncio
async def test_sync_now_refuses_a_connection_that_needs_reauth(
    connection: ProviderConnection,
) -> None:
    """Queuing work for a dead grant just burns a worker slot to fail."""
    from app.services import provider_connection_service

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        row.status = "needs_reauth"
        row.last_error = "Reconnect to resume syncing."
        await session.commit()

    async with async_session_factory() as session:
        response = await provider_connection_service.sync_now(session, connection.id, connection.user_id)
    assert not response.success


@pytest.mark.asyncio
async def test_sync_now_is_scoped_to_its_owner(connection: ProviderConnection) -> None:
    """Another user's connection id must not be actionable."""
    from app.services import provider_connection_service

    async with async_session_factory() as session:
        response = await provider_connection_service.sync_now(session, connection.id, uuid.uuid4())
    assert not response.success
    assert response.error_code == "not_found"


@pytest.mark.asyncio
async def test_a_freshly_synced_connection_is_not_due_again_immediately(
    connection: ProviderConnection,
) -> None:
    """poll_interval_s was written on every stream and read by nobody, so the
    60-second beat tick re-synced everything every 60 seconds — five times the
    intended Google traffic, from a column that looked like a working control.
    """
    from datetime import timedelta

    from app.models.providers import SyncStream

    async with async_session_factory() as session:
        fresh = await session.get(ProviderConnection, connection.id)
        assert fresh is not None
        # No streams yet: never run, so due.
        #
        # The generous limit is load-bearing. due_connections pages at 50,
        # ordered by staleness, and this database is not truncated between
        # runs — so with rows accumulated from earlier runs the newest
        # connection falls outside the window and the assertion fails for a
        # reason that has nothing to do with the behaviour under test.
        assert await _is_due(session, connection)

        session.add(
            SyncStream(
                connection_id=connection.id,
                stream=STREAM,
                poll_interval_s=300,
                last_success_at=datetime.now(UTC),
            )
        )
        await session.commit()

    async with async_session_factory() as session:
        assert not await _is_due(session, connection), "synced seconds ago and already due again"

    # Wind the clock back past the interval and it becomes due.
    async with async_session_factory() as session:
        stream = (
            (await session.execute(select(SyncStream).where(SyncStream.connection_id == connection.id)))
            .scalars()
            .first()
        )
        assert stream is not None
        stream.last_success_at = datetime.now(UTC) - timedelta(seconds=400)
        await session.commit()

    async with async_session_factory() as session:
        assert await _is_due(session, connection), "past its interval and still not due"


@pytest.mark.asyncio
async def test_a_connection_in_backoff_is_left_alone(connection: ProviderConnection) -> None:
    """Backoff has to actually hold, or a broken connection is retried every
    tick and burns quota failing."""
    from datetime import timedelta

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        row.status = "transient_broken"
        row.disabled_until = datetime.now(UTC) + timedelta(minutes=10)
        await session.commit()

    async with async_session_factory() as session:
        assert not await _is_due(session, connection)


# ── the page loop ───────────────────────────────────────────────────────────
#
# Everything above hands the engine a single done=True page, so pagination,
# mid-walk resume and the "cursor only advances on the final page" rule have
# been assertions in comments rather than in tests. They are also the highest
# consequence part of the design: a mishandled cursor skips records silently
# and permanently, with no error and nothing in a log.


class _Scripted:
    """An adapter that replays a fixed list of pages and records its inputs."""

    id = "google_calendar"
    name = "Google Calendar"
    scopes = ()

    def __init__(self, pages: list[providers.SyncPage], *, fail_on: int | None = None) -> None:
        self._pages = pages
        self._fail_on = fail_on
        self.seen: list[tuple[str, str]] = []  # (cursor_token, page_token) per call
        self.calls = 0

    def streams(self, settings):
        return [STREAM]

    def cursor_params(self, stream, settings):
        return {"singleEvents": "false"}

    async def fetch(self, ctx):
        self.seen.append((ctx.cursor_token, ctx.page_token))
        index = self.calls
        self.calls += 1
        if self._fail_on is not None and index == self._fail_on:
            raise providers.ProviderError("upstream fell over", error_class="provider_5xx")
        return self._pages[index]


def _page(ids: list[str], *, next_page: str = "", cursor: str = "") -> providers.SyncPage:
    return providers.SyncPage(
        records=[
            providers.SyncRecord(external_id=i, title=f"Event {i}", folder="Calendar/2026/09", body=f"# Event {i}\n")
            for i in ids
        ],
        next_page_token=next_page,
        next_cursor=cursor,
        done=not next_page,
    )


async def _run_with(connection: ProviderConnection, adapter) -> None:
    import app.services.provider_sync_service as engine

    async def _token(db, conn) -> str:
        return "token"

    original_adapter, original_token = providers.get_adapter, engine.access_token_for
    providers.get_adapter = lambda _id: adapter  # type: ignore[assignment]
    engine.access_token_for = _token  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            fresh = await session.get(ProviderConnection, connection.id)
            assert fresh is not None
            await engine.sync_connection(session, fresh)
    finally:
        providers.get_adapter = original_adapter  # type: ignore[assignment]
        engine.access_token_for = original_token  # type: ignore[assignment]


async def _stream_row(connection: ProviderConnection):
    from app.models.providers import SyncStream

    async with async_session_factory() as session:
        return (
            (await session.execute(select(SyncStream).where(SyncStream.connection_id == connection.id)))
            .scalars()
            .first()
        )


async def _note_titles(connection: ProviderConnection) -> list[str]:
    async with async_session_factory() as session:
        rows = await session.execute(
            select(Note.title).where(Note.vault_id == connection.vault_id, Note.title.like("Event %"))
        )
        return sorted(rows.scalars())


@pytest.mark.asyncio
async def test_a_multi_page_walk_imports_everything_and_advances_once(
    connection: ProviderConnection,
) -> None:
    """The cursor may only move on the final page. Persisting one from the
    middle of a walk skips every record after it, forever, in silence."""
    adapter = _Scripted(
        [
            _page(["a", "b"], next_page="p2", cursor="MIDDLE_TOKEN_MUST_BE_IGNORED"),
            _page(["c", "d"], next_page="p3", cursor="ALSO_IGNORED"),
            _page(["e"], cursor="FINAL"),
        ]
    )
    await _run_with(connection, adapter)

    assert await _note_titles(connection) == ["Event a", "Event b", "Event c", "Event d", "Event e"]

    stream = await _stream_row(connection)
    assert stream is not None
    assert stream.cursor_token == "FINAL", "a mid-walk token was promoted to the cursor"
    assert stream.page_token == "", "the walk finished but a page token was left behind"
    assert stream.backfill_done is True
    # Each page must carry the previous page's token, or the walk repeats page 1.
    assert [pt for _, pt in adapter.seen] == ["", "p2", "p3"]


@pytest.mark.asyncio
async def test_a_crash_mid_walk_loses_nothing_on_replay(connection: ProviderConnection) -> None:
    """The write-then-advance ordering exists for exactly this. A failure part
    way through must replay the page, and replay must be free."""
    # Page one carries BOTH a next page and a cursor. Google would not send
    # that combination, and the point is precisely that: if the engine ever
    # promotes a cursor from a non-final page, the crash below leaves a token
    # that skips "c" forever. Asserting only the end state of a *completed*
    # walk cannot see that — the final value is the same either way, which is
    # how the first version of this test passed against a deliberately broken
    # engine.
    first = _Scripted(
        [
            _page(["a", "b"], next_page="p2", cursor="MUST_NOT_BE_PROMOTED"),
            _page(["c"], cursor="FINAL"),
        ],
        fail_on=1,  # dies fetching the second page
    )
    await _run_with(connection, first)

    # Page one landed; the cursor did not move.
    assert await _note_titles(connection) == ["Event a", "Event b"]
    stream = await _stream_row(connection)
    assert stream is not None
    assert stream.cursor_token == "", "the cursor advanced despite an incomplete walk"
    assert stream.page_token == "p2", "the resume point was lost"

    async with async_session_factory() as session:
        broken = await session.get(ProviderConnection, connection.id)
        assert broken is not None
        assert broken.status == "transient_broken"
        broken.disabled_until = None  # skip the backoff for the test
        await session.commit()

    # Replay from the stored page token.
    second = _Scripted([_page(["c"], cursor="FINAL")])
    await _run_with(connection, second)

    assert await _note_titles(connection) == ["Event a", "Event b", "Event c"], "records lost or duplicated"
    assert second.seen[0][1] == "p2", "the replay did not resume from the stored page token"
    stream = await _stream_row(connection)
    assert stream is not None and stream.cursor_token == "FINAL"


@pytest.mark.asyncio
async def test_one_run_is_bounded_and_the_next_tick_continues(
    connection: ProviderConnection,
) -> None:
    """A backfill must not hold a worker indefinitely; it should make progress
    and hand back."""
    from app.services.provider_sync_service import MAX_PAGES_PER_RUN

    pages = [_page([f"n{i}"], next_page=f"p{i + 1}") for i in range(MAX_PAGES_PER_RUN + 2)]
    pages[-1] = _page([f"n{len(pages) - 1}"], cursor="FINAL")

    adapter = _Scripted(list(pages))
    await _run_with(connection, adapter)

    assert adapter.calls == MAX_PAGES_PER_RUN, "the run did not stop at its page bound"
    stream = await _stream_row(connection)
    assert stream is not None
    assert stream.cursor_token == "", "an unfinished walk advanced the cursor"
    assert stream.page_token, "the next tick has no resume point"
    assert len(await _note_titles(connection)) == MAX_PAGES_PER_RUN


@pytest.mark.asyncio
async def test_changing_the_frozen_query_forces_a_full_resync(
    connection: ProviderConnection,
) -> None:
    """Google invalidates a Calendar sync token when singleEvents or eventTypes
    change, and says nothing — it returns a plausible partial result. Comparing
    the stored params turns that into a deliberate resync."""
    from app.models.providers import SyncStream

    await _run_with(connection, _Scripted([_page(["a"], cursor="FIRST")]))

    async with async_session_factory() as session:
        stream = (
            (await session.execute(select(SyncStream).where(SyncStream.connection_id == connection.id)))
            .scalars()
            .first()
        )
        assert stream is not None and stream.cursor_token == "FIRST"
        # Simulate the adapter's frozen params having changed since minting.
        stream.cursor_params = {"singleEvents": "true"}
        await session.commit()

    adapter = _Scripted([_page(["a", "b"], cursor="SECOND")])
    await _run_with(connection, adapter)

    # The stale cursor must not have been sent.
    assert adapter.seen[0][0] == "", "a cursor minted under different params was reused"
    stream = await _stream_row(connection)
    assert stream is not None and stream.cursor_token == "SECOND"


# ── settings: the one blob a user writes into the engine's own config ───────


@pytest.mark.asyncio
async def test_the_settings_patch_refuses_a_value_that_would_kill_the_poller(
    client: AsyncClient, workspace: dict, connection: ProviderConnection
) -> None:
    """Through the real endpoint, because the validator only matters if it is
    actually wired to the route the UI calls."""
    url = f"/api/v1/connections/connections/{connection.id}"
    for patch in (
        {"people_threshold": "soon"},
        {"calendar": {"calendar_ids": ["c"] * 40}},
        {"calendar": {"calendar_ids": "primary"}},
        {"gmail": {"store_bodies": "yes"}},
    ):
        resp = await client.patch(url, json=patch, headers=workspace["headers"])
        assert resp.status_code == 422, f"{patch} was accepted: {resp.text}"
        assert resp.json()["error"]["message"]

    # And nothing was half-written on the way to being refused.
    async with async_session_factory() as session:
        fresh = await session.get(ProviderConnection, connection.id)
        assert fresh is not None
        assert fresh.settings == {}


@pytest.mark.asyncio
async def test_a_good_patch_is_stored_and_reconciles_streams(
    client: AsyncClient, workspace: dict, connection: ProviderConnection
) -> None:
    resp = await client.patch(
        f"/api/v1/connections/connections/{connection.id}",
        json={
            "folder_root": "Sources/../Google",
            "people_threshold": 5,
            "calendar": {"calendar_ids": ["primary", "b"]},
        },
        headers=workspace["headers"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()["data"]
    assert body["settings"]["folder_root"] == "Sources/Google"
    assert body["settings"]["people_threshold"] == 5
    assert {s["stream"] for s in body["streams"]} == {"calendar:events:primary", "calendar:events:b"}
    # Tokens never appear in a settings response any more than in a list one.
    assert "refresh" not in resp.text.lower()


@pytest.mark.asyncio
async def test_a_poisoned_settings_blob_still_syncs(connection: ProviderConnection) -> None:
    """Rows written before the validator existed are still in the table, and
    `clean` cannot reach them. The engine has to survive its own history."""
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        row.settings = {
            "people_threshold": "soon",
            "folder_root": "../../etc",
            "calendar": {"calendar_ids": "primary", "backfill_days": "many"},
        }
        await session.commit()

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        outcome = await provider_sync_service.apply_record(session, row, STREAM, _record(), people_counts={})
        assert outcome == "created"
        note = await session.scalar(select(Note).where(Note.vault_id == row.vault_id, Note.title == "Design review"))
        assert note is not None
        # The traversal prefix collapsed instead of escaping the folder tree.
        assert note.path.startswith("etc/Calendar/2026/09"), note.path


# ── one grant, several vaults ───────────────────────────────────────────────


async def _second_vault_connection(workspace: dict, first: ProviderConnection) -> ProviderConnection:
    """The same Google account connected to a second vault of the same user."""
    from app.models.vaults import Vault

    async with async_session_factory() as session:
        vault = Vault(user_id=workspace["user_id"], name=f"Second vault {uuid.uuid4().hex[:6]}")
        session.add(vault)
        await session.commit()
        await session.refresh(vault)

        row = ProviderConnection(
            user_id=workspace["user_id"],
            vault_id=vault.id,
            provider="google_calendar",
            # Same Google account: this is what makes it the same grant.
            external_account_id=first.external_account_id,
            external_email=first.external_email,
            connected_at=datetime.now(UTC),
            settings={},
            people_counts={},
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


def _capture_revokes():
    """Swap google_auth.revoke for a recorder; returns (list, restore)."""
    from app.services.providers import google_auth

    seen: list[str] = []

    async def _capture(token: str) -> None:
        seen.append(token)

    original = google_auth.revoke
    google_auth.revoke = _capture  # type: ignore[assignment]

    def restore() -> None:
        google_auth.revoke = original  # type: ignore[assignment]

    return seen, restore


async def _store_refresh(connection_id: uuid.UUID, value: str) -> None:
    from app.utils.crypto_utils import encrypt_secret

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection_id)
        assert row is not None
        row.refresh_ciphertext = encrypt_secret(value, purpose="oauth")
        await session.commit()


@pytest.mark.asyncio
async def test_disconnecting_one_vault_leaves_another_vaults_connection_alive(
    workspace: dict, connection: ProviderConnection
) -> None:
    """Google revokes by *grant*, not by token: withdrawing one refresh token
    withdraws every token issued under the same authorisation, which for one
    OAuth client and one Google account is all of them.

    So disconnecting a calendar from one vault used to kill the same account's
    connection to another vault — which then reported "Google revoked this
    connection… access was removed from your Google account". That message is
    not merely unhelpful, it is wrong: we did it. And the docs promise a
    second vault gets an independent connection.
    """
    from app.services import provider_connection_service

    other = await _second_vault_connection(workspace, connection)
    await _store_refresh(connection.id, "shared-refresh-token")

    seen, restore = _capture_revokes()
    try:
        async with async_session_factory() as session:
            response = await provider_connection_service.disconnect(session, connection.id, workspace["user_id"])
    finally:
        restore()

    assert response.success
    assert seen == [], "the still-connected vault's grant was withdrawn"

    async with async_session_factory() as session:
        assert await session.get(ProviderConnection, connection.id) is None
        survivor = await session.get(ProviderConnection, other.id)
        assert survivor is not None, "the other vault's connection was deleted too"


@pytest.mark.asyncio
async def test_disconnecting_the_last_one_does_hand_the_grant_back(
    workspace: dict, connection: ProviderConnection
) -> None:
    """The check must not become an excuse never to revoke. With nothing else
    on the grant, leaving it standing is the failure it was written to fix."""
    from app.services import provider_connection_service

    await _store_refresh(connection.id, "only-refresh-token")

    seen, restore = _capture_revokes()
    try:
        async with async_session_factory() as session:
            assert (await provider_connection_service.disconnect(session, connection.id, workspace["user_id"])).success
    finally:
        restore()

    assert seen == ["only-refresh-token"]


@pytest.mark.asyncio
async def test_deleting_a_vault_spares_a_grant_another_vault_still_uses(
    workspace: dict, connection: ProviderConnection
) -> None:
    from app.services import provider_connection_service

    await _second_vault_connection(workspace, connection)
    await _store_refresh(connection.id, "shared-refresh-token")

    seen, restore = _capture_revokes()
    try:
        async with async_session_factory() as session:
            count = await provider_connection_service.revoke_grants(session, vault_id=connection.vault_id)
    finally:
        restore()

    assert count == 0
    assert seen == []


@pytest.mark.asyncio
async def test_closing_the_account_revokes_each_grant_exactly_once(
    workspace: dict, connection: ProviderConnection
) -> None:
    """Everything goes, so there is nothing to spare — but one grant shared by
    two connections is still one revoke, not two round trips to Google during
    a deletion the user is waiting on."""
    from app.services import provider_connection_service

    other = await _second_vault_connection(workspace, connection)
    await _store_refresh(connection.id, "shared-refresh-token")
    await _store_refresh(other.id, "shared-refresh-token")

    seen, restore = _capture_revokes()
    try:
        async with async_session_factory() as session:
            count = await provider_connection_service.revoke_grants(session, user_id=workspace["user_id"])
    finally:
        restore()

    assert count == 1
    assert seen == ["shared-refresh-token"]


# ── manual sync is not a free button ────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_held_down_sync_button_does_not_flood_the_broker(
    connection: ProviderConnection,
) -> None:
    """The general limiter allows 300 requests a minute. Without a throttle
    here that is 300 tasks on the broker from one account, sitting ahead of
    the sweep, of email, of every import — the leases mean they mostly do no
    work, which makes it cheap to do and invisible while it happens."""
    from app.core import celery as celery_module
    from app.services import provider_connection_service

    sent: list[str] = []
    original = celery_module.celery_app.send_task
    celery_module.celery_app.send_task = lambda name, args=None, **kw: sent.append(name)  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            first = await provider_connection_service.sync_now(session, connection.id, connection.user_id)
            second = await provider_connection_service.sync_now(session, connection.id, connection.user_id)
            third = await provider_connection_service.sync_now(session, connection.id, connection.user_id)
    finally:
        celery_module.celery_app.send_task = original  # type: ignore[assignment]

    assert first.success
    assert not second.success and second.error_code == "rate_limited"
    assert not third.success
    # And it says when, rather than just refusing.
    assert "seconds" in second.message
    assert len(sent) == 1, f"{len(sent)} tasks queued for one connection"


@pytest.mark.asyncio
async def test_the_throttle_is_per_connection_not_per_account(workspace: dict, connection: ProviderConnection) -> None:
    """Two connections are two things to sync; one being busy is no reason to
    refuse the other."""
    from app.core import celery as celery_module
    from app.services import provider_connection_service

    other = await _second_vault_connection(workspace, connection)

    sent: list[str] = []
    original = celery_module.celery_app.send_task
    celery_module.celery_app.send_task = lambda name, args=None, **kw: sent.append(name)  # type: ignore[assignment]
    try:
        async with async_session_factory() as session:
            assert (await provider_connection_service.sync_now(session, connection.id, connection.user_id)).success
            assert (await provider_connection_service.sync_now(session, other.id, other.user_id)).success
    finally:
        celery_module.celery_app.send_task = original  # type: ignore[assignment]

    assert len(sent) == 2


@pytest.mark.asyncio
async def test_removing_a_calendar_stops_reporting_it_but_keeps_its_place(
    client: AsyncClient, workspace: dict, connection: ProviderConnection
) -> None:
    """Un-ticking a calendar has to stop it syncing *and* stop it being shown.

    The stream row stays behind on purpose — cursor and all — so re-ticking
    resumes rather than re-walking a year and rebuilding every note. But the
    row is not evidence of anything current: reported anyway, the calendar you
    just removed keeps showing its counts and its last-synced time, and the
    settings panel appears to have done nothing.
    """

    url = f"/api/v1/connections/connections/{connection.id}"
    both = await client.patch(
        url, json={"calendar": {"calendar_ids": ["primary", "work"]}}, headers=workspace["headers"]
    )
    assert both.status_code == 200, both.text
    assert {s["stream"] for s in both.json()["data"]["streams"]} == {
        "calendar:events:primary",
        "calendar:events:work",
    }

    async with async_session_factory() as session:
        stream = await session.scalar(
            select(SyncStream).where(
                SyncStream.connection_id == connection.id, SyncStream.stream == "calendar:events:work"
            )
        )
        assert stream is not None
        stream.cursor_token = "sync-token-worth-keeping"
        stream.records_seen = 42
        await session.commit()

    one = await client.patch(url, json={"calendar": {"calendar_ids": ["primary"]}}, headers=workspace["headers"])
    assert one.status_code == 200, one.text
    assert {s["stream"] for s in one.json()["data"]["streams"]} == {"calendar:events:primary"}

    # The engine agrees: a removed calendar is not run.
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        running = {s.stream for s in await provider_sync_service.ensure_streams(session, row)}
        assert running == {"calendar:events:primary"}

        # And its place in the sync survived, so re-ticking is cheap.
        kept = await session.scalar(
            select(SyncStream).where(
                SyncStream.connection_id == connection.id, SyncStream.stream == "calendar:events:work"
            )
        )
        assert kept is not None and kept.cursor_token == "sync-token-worth-keeping"

    back = await client.patch(
        url, json={"calendar": {"calendar_ids": ["primary", "work"]}}, headers=workspace["headers"]
    )
    assert {s["stream"] for s in back.json()["data"]["streams"]} == {
        "calendar:events:primary",
        "calendar:events:work",
    }
    resumed = next(s for s in back.json()["data"]["streams"] if s["stream"].endswith("work"))
    assert resumed["records_seen"] == 42, "re-ticking threw away what it had already synced"


# ── what a failure is allowed to say ────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_failure_never_reports_third_party_or_internal_text(
    client: AsyncClient, workspace: dict, connection: ProviderConnection
) -> None:
    """`last_error` is rendered in the UI and returned by the API, so it is
    copy — not a place for whatever string happened to be raised.

    Two paths put raw text there. Google's error bodies, on the
    unclassified-4xx branch, which are JSON that can name the account and the
    resource. And `except Exception`, whose `str(exc)` for a database error is
    the full SQL statement and sometimes its parameters — handed to a user over
    the API, from a failure that had nothing to do with them.
    """
    from app.services import provider_sync_service
    from app.services.providers import base as provider_base

    leaks = [
        provider_base.ProviderError(
            'Calendar returned 403: {"error":{"message":"user@private.example is not authorised",'
            '"details":[{"resource":"projects/internal-42"}]}}'
        ),
        provider_base.ProviderError(
            "(sqlalchemy) INSERT INTO provider_connections (refresh_ciphertext) VALUES ('gAAAAA-secret')",
            error_class="bug",
        ),
        provider_base.ProviderError("Gmail returned 400: quotaUser=user@private.example", error_class="rate_limit"),
        provider_base.ProviderError("Could not reach Google: ConnectError at 10.1.2.3:443", error_class="provider_5xx"),
    ]

    for exc in leaks:
        async with async_session_factory() as session:
            row = await session.get(ProviderConnection, connection.id)
            assert row is not None
            await provider_sync_service._record_failure(session, row, exc)

        listed = await client.get("/api/v1/connections/connections", headers=workspace["headers"])
        assert listed.status_code == 200, listed.text
        body = listed.text
        for secret in ("private.example", "internal-42", "gAAAAA-secret", "INSERT INTO", "10.1.2.3"):
            assert secret not in body, f"{secret!r} reached the API in last_error"

        shown = next(c["last_error"] for c in listed.json()["data"] if c["id"] == str(connection.id))
        assert shown, "a failure with nothing to say is worse than one with the wrong thing to say"


@pytest.mark.asyncio
async def test_the_messages_a_user_can_act_on_are_kept(connection: ProviderConnection) -> None:
    """The rule must not flatten the two failures that have a real fix.

    A seven-day Testing-mode grant and a changed encryption key are the only
    ones where the message *is* the remedy, and replacing either with generic
    copy would undo the whole point of classifying them.
    """
    from app.services import provider_sync_service
    from app.services.providers import base as provider_base

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        row.connected_at = datetime.now(UTC) - timedelta(days=7)
        await provider_sync_service._record_failure(
            session, row, provider_base.ProviderError('{"error":"invalid_grant"}', error_class="auth")
        )
        assert "Publish app" in row.last_error, row.last_error
        assert row.status == "needs_reauth"

        await provider_sync_service._record_failure(
            session,
            row,
            provider_base.ProviderError(
                "Stored credentials could not be decrypted — the server's encryption key has changed.",
                error_class="config",
            ),
        )
        assert "encryption key" in row.last_error
        assert row.status == "key_unavailable"


# ── when the marker is gone ─────────────────────────────────────────────────


async def _content(note_id: uuid.UUID) -> str:
    """Read in a fresh session. `apply_record` writes in its own, and a session
    that already holds the note can hand back its own snapshot — which for a
    test asserting "nothing changed" would pass no matter what happened."""
    async with async_session_factory() as session:
        note = await session.get(Note, note_id)
        assert note is not None
        return note.content


async def _overwrite(connection: ProviderConnection, note_id: uuid.UUID, content: str) -> None:
    async with async_session_factory() as session:
        response = await note_service.update_content(
            session, connection.vault_id, connection.user_id, note_id, content=content
        )
        assert response.success, response.message


async def _synced_note_id(connection: ProviderConnection) -> uuid.UUID:
    async with async_session_factory() as session:
        note = await session.scalar(
            select(Note).where(Note.vault_id == connection.vault_id, Note.title == "Design review")
        )
        assert note is not None
        return note.id


@pytest.mark.asyncio
async def test_a_note_whose_marker_was_removed_is_not_taken_over(
    connection: ProviderConnection,
) -> None:
    """`## Notes` is a plain heading in a note the user edits freely, and some
    will delete it — tidying up, or not realising it is load-bearing.

    Without the marker `split_user_region` reports the whole note as sync's, so
    the next update replaced every word of it. That is the one thing this
    feature promises never to do, and it would have happened silently, to
    writing that exists nowhere else.
    """
    assert await _apply(connection, _record()) == "created"
    note_id = await _synced_note_id(connection)

    # The user takes the note over: their own words, no marker.
    await _overwrite(connection, note_id, "# Design review\n\nAmara pushed back on the timeline. Follow up Tuesday.\n")

    outcome = await _apply(connection, _record(body="# Design review\n\nsecond version\n", version=1))
    assert outcome == "left_alone"

    kept = await _content(note_id)
    assert "Follow up Tuesday." in kept, "the user's writing was replaced"
    assert "second version" not in kept


@pytest.mark.asyncio
async def test_putting_the_marker_back_makes_the_note_sync_again(
    connection: ProviderConnection,
) -> None:
    """Left alone must not mean abandoned. The hash is deliberately not
    recorded while a note is being left alone, so restoring the heading brings
    it back rather than leaving it matching forever."""
    await _apply(connection, _record())
    note_id = await _synced_note_id(connection)

    await _overwrite(connection, note_id, "# Design review\n\nmine\n")
    moved = _record(body="# Design review\n\nsecond version\n", version=1)
    assert await _apply(connection, moved) == "left_alone"

    # They put it back, with their writing underneath.
    await _overwrite(connection, note_id, "# Design review\n\nold\n\n## Notes\n\nmine\n")
    assert await _apply(connection, moved) == "updated"

    synced = await _content(note_id)
    assert "second version" in synced
    assert "mine" in synced, "restoring the marker cost the user their writing"
