"""The sweep, which is the only reason any of this is *live*.

Nothing else runs on its own. If this tick stops, every connection quietly
stops updating and the UI keeps showing whatever it last said — "Last synced"
recedes into the past and nothing anywhere reports a problem, because from the
application's point of view nothing failed.

The claim worth testing is the resilience one. Connections belong to different
people, and they are processed in one loop over one session: a single revoked
grant that raises must not stop the connections after it, and must not poison
the session either, or one person's broken account stops everybody else's
calendar from syncing.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core.db import async_session_factory
from app.models.providers import ProviderConnection
from app.services import provider_sync_service
from app.tasks import provider_sync as task_module


async def _account(client: AsyncClient, label: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"{label}-{uuid.uuid4().hex[:10]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Sweep Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {
        "vault_id": uuid.UUID(vaults[0]["id"]),
        "user_id": uuid.UUID(resp.json()["data"]["user"]["id"]),
    }


async def _connection(account: dict, *, stale_minutes: int = 60) -> ProviderConnection:
    """A connection due for a poll — that is what puts it in the sweep."""
    async with async_session_factory() as session:
        row = ProviderConnection(
            user_id=account["user_id"],
            vault_id=account["vault_id"],
            provider="google_calendar",
            external_account_id=uuid.uuid4().hex,
            external_email="tester@example.com",
            connected_at=datetime.now(UTC) - timedelta(minutes=stale_minutes),
            settings={},
            people_counts={},
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


@pytest.mark.asyncio
async def test_one_broken_connection_does_not_stop_everybody_elses(client: AsyncClient) -> None:
    """Two different people. The first one raises.

    Without the guard the exception leaves the loop and the tick dies, so every
    connection ordered after the broken one is never polled — and because
    `due_connections` orders by staleness, the broken one stays first forever.
    One revoked grant would freeze the whole instance.
    """
    first = await _connection(await _account(client, "broken"))
    second = await _connection(await _account(client, "healthy"))

    ran: list[uuid.UUID] = []
    original = provider_sync_service.sync_connection

    async def _explode(session, connection):
        ran.append(connection.id)
        if connection.id == first.id:
            raise RuntimeError("Google said no")
        return await original(session, connection)

    provider_sync_service.sync_connection = _explode  # type: ignore[assignment]
    try:
        totals = await task_module.run_due(limit=1000)
    finally:
        provider_sync_service.sync_connection = original  # type: ignore[assignment]

    assert first.id in ran
    assert second.id in ran, "the connection after the broken one was never reached"
    assert totals["failed"] >= 1


@pytest.mark.asyncio
async def test_a_poisoned_session_is_rolled_back_before_the_next_connection(
    client: AsyncClient,
) -> None:
    """A failed *statement* is worse than a failed call.

    SQLAlchemy refuses every subsequent statement on that session, so the
    connections after it fail for a reason that has nothing to do with them and
    the logs blame the wrong accounts. Worse, the obvious guard does not hold:
    `session.rollback()` on a connection already broken at the asyncpg level
    raises as well, and that escapes the handler written to prevent all of
    this. The fix is a session per connection — no shared state to poison.
    """
    first = await _connection(await _account(client, "poison"))
    second = await _connection(await _account(client, "after"))

    outcomes: dict[uuid.UUID, str] = {}
    original = provider_sync_service.sync_connection

    async def _poison(session, connection):
        if connection.id == first.id:
            # A real database error, not a Python one — a violated constraint
            # is what leaves the session refusing every further statement.
            session.add(
                ProviderConnection(
                    user_id=connection.user_id,
                    vault_id=connection.vault_id,
                    provider="google_calendar",
                    external_account_id=connection.external_account_id,
                    external_email="clash@example.com",
                    connected_at=datetime.now(UTC),
                    settings={},
                    people_counts={},
                )
            )
            await session.flush()
        result = await original(session, connection)
        outcomes[connection.id] = "ran"
        return result

    provider_sync_service.sync_connection = _poison  # type: ignore[assignment]
    try:
        totals = await task_module.run_due(limit=1000)
    finally:
        provider_sync_service.sync_connection = original  # type: ignore[assignment]

    assert outcomes.get(second.id) == "ran", (
        "the connection after the broken one never ran — a shared session that a "
        "failed statement left refusing everything, or a rollback that raised too"
    )
    assert totals["connections"] >= 2
    assert totals["failed"] >= 1


@pytest.mark.asyncio
async def test_the_tick_is_bounded_so_one_large_instance_does_not_stall_it(
    client: AsyncClient,
) -> None:
    """The bound is fairness, not throughput: `due_connections` orders by
    staleness, so a tick that takes the oldest N never starves anyone."""
    account = await _account(client, "many")
    for _ in range(4):
        await _connection(account)

    seen: list[uuid.UUID] = []
    original = provider_sync_service.sync_connection

    async def _count(session, connection):
        seen.append(connection.id)
        return await original(session, connection)

    provider_sync_service.sync_connection = _count  # type: ignore[assignment]
    try:
        totals = await task_module.run_due(limit=2)
    finally:
        provider_sync_service.sync_connection = original  # type: ignore[assignment]

    assert len(seen) == 2, f"the tick ran {len(seen)} connections with a limit of 2"
    assert totals["connections"] == 2


@pytest.mark.asyncio
async def test_a_connection_deleted_before_the_worker_ran_is_not_an_error(
    client: AsyncClient,
) -> None:
    """Pressing Sync now and then Disconnect is an ordinary sequence. If the
    task raised on the missing row, Celery would retry it — repeatedly, against
    a row the user deliberately deleted."""
    result = await task_module.run_one(str(uuid.uuid4()))
    assert result == {"missing": 1}


@pytest.mark.asyncio
async def test_the_manual_task_reports_which_way_a_run_went(client: AsyncClient) -> None:
    connection = await _connection(await _account(client, "manual"))
    result = await task_module.run_one(str(connection.id))
    assert result in ({"ok": 1}, {"failed": 1})
    assert "missing" not in result
