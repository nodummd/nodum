"""Periodic maintenance jobs (Celery beat)."""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, or_

from app.core.celery import celery_app
from app.core.logging import get_logger
from app.models.auth import Session

logger = get_logger("maintenance")

# Invalidated/expired sessions are kept this long for audit, then pruned.
SESSION_RETENTION_DAYS = 30


@celery_app.task(name="tasks.prune_sessions")
def prune_sessions() -> int:
    """Delete sessions that expired or were invalidated more than the
    retention window ago — keeps the table bounded at scale."""

    async def _prune() -> int:
        from app.core.db import async_session_factory

        cutoff = datetime.now(UTC) - timedelta(days=SESSION_RETENTION_DAYS)
        async with async_session_factory() as session:
            result = await session.execute(
                delete(Session).where(
                    or_(
                        Session.expires_at < cutoff,
                        and_(Session.invalidated_at.is_not(None), Session.invalidated_at < cutoff),
                    )
                )
            )
            await session.commit()
            return result.rowcount or 0

    pruned = asyncio.run(_prune())
    logger.info("sessions_pruned", count=pruned)
    return pruned
