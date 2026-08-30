"""Periodic sync of connected data sources (Celery beat).

The dispatcher is deliberately dumb: every tick it asks which connections are
due, and runs them. All the intelligence — backoff, leases, cursor handling,
dead-connection detection — lives in `provider_sync_service`, where it is
reachable from a unit test without a broker.

One connection failing must never stop the others, so each is isolated. A user
whose Google grant was revoked should not be able to stall everyone else's
calendar sync by existing.
"""

import asyncio

from app.core.celery import celery_app
from app.core.logging import get_logger
from app.services import provider_sync_service

logger = get_logger("provider_sync_task")

#: Connections handled per tick. The tick is frequent, so this is a fairness
#: bound rather than a throughput one: `due_connections` orders by staleness,
#: so nobody is starved, and a large instance simply spreads across more ticks.
BATCH = 25


# The task bodies live here as plain async functions, and the Celery tasks
# below are `asyncio.run` wrappers. Sealed inside a closure they could only be
# reached through a broker, and the claims they make — one bad connection must
# not stop the others, a run must survive a poisoned session — are exactly the
# ones worth a test.


async def run_one(connection_id: str) -> dict[str, int]:
    from uuid import UUID

    from app.core.db import async_session_factory
    from app.models.providers import ProviderConnection

    async with async_session_factory() as session:
        connection = await session.get(ProviderConnection, UUID(connection_id))
        if connection is None:
            # Disconnected between pressing the button and the worker picking
            # it up. Not an error: the task must not retry forever over a row
            # the user deliberately deleted.
            return {"missing": 1}
        response = await provider_sync_service.sync_connection(session, connection)
        return {"ok": 1} if response.success else {"failed": 1}


async def run_due(limit: int = BATCH) -> dict[str, int]:
    """Run every connection that is due, each in its own session.

    One loop over one shared session was the obvious shape and the wrong one.
    A connection whose sync raised a *database* error left that session
    refusing every further statement, so the connections after it failed for a
    reason that had nothing to do with them — and the recovery could not be
    relied on either: `session.rollback()` on a connection already broken at
    the asyncpg level raises too, which escapes the handler that exists to stop
    exactly this. One person's revoked grant would end the tick, and because
    `due_connections` orders by staleness that person stays first, so it would
    end every tick after it as well.

    A session each removes the shared state instead of guarding it. The ids are
    read first and the listing session closed, so nothing survives into the
    runs to be poisoned.
    """
    from app.core.db import async_session_factory

    async with async_session_factory() as session:
        due = [str(connection.id) for connection in await provider_sync_service.due_connections(session, limit=limit)]

    totals = {"connections": 0, "ok": 0, "failed": 0}
    for connection_id in due:
        totals["connections"] += 1
        try:
            result = await run_one(connection_id)
        except Exception:
            logger.exception("connection_sync_crashed", connection=connection_id)
            totals["failed"] += 1
            continue
        if result.get("ok"):
            totals["ok"] += 1
        elif result.get("failed"):
            totals["failed"] += 1
        else:
            # Disconnected between the listing and the run. Counted so the
            # totals still add up rather than quietly losing one.
            totals["missing"] = totals.get("missing", 0) + 1
    return totals


@celery_app.task(name="tasks.sync_connection")
def sync_connection(connection_id: str) -> dict[str, int]:
    """Run one connection now, because a person pressed the button.

    Separate from the scheduled sweep so an on-demand run is not queued behind
    everyone else's, and — more importantly — so it does not happen inside the
    HTTP request. A first Calendar backfill walks up to eight pages of 250
    events, each of which computes an embedding; done inline that is minutes of
    work holding a web worker, ending in a client timeout and a user who
    presses the button again.
    """
    result = asyncio.run(run_one(connection_id))
    logger.info("provider_sync_manual", connection=connection_id, **result)
    return result


@celery_app.task(name="tasks.sync_providers")
def sync_providers() -> dict[str, int]:
    """Run every connection that is due a poll."""
    result = asyncio.run(run_due())
    if result["connections"]:
        logger.info("provider_sync_tick", **result)
    return result
