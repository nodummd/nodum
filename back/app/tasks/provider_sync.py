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


@celery_app.task(name="tasks.sync_providers")
def sync_providers() -> dict[str, int]:
    """Run every connection that is due a poll."""

    async def _run() -> dict[str, int]:
        from app.core.db import async_session_factory

        totals = {"connections": 0, "ok": 0, "failed": 0}
        async with async_session_factory() as session:
            due = await provider_sync_service.due_connections(session, limit=BATCH)
            for connection in due:
                totals["connections"] += 1
                try:
                    response = await provider_sync_service.sync_connection(session, connection)
                    totals["ok" if response.success else "failed"] += 1
                except Exception:
                    logger.exception("connection_sync_crashed", connection=str(connection.id))
                    totals["failed"] += 1
                    # The session may be poisoned by the failed statement; roll
                    # back before touching the next connection or every
                    # subsequent one fails with PendingRollbackError.
                    await session.rollback()
        return totals

    result = asyncio.run(_run())
    if result["connections"]:
        logger.info("provider_sync_tick", **result)
    return result
