"""Community periodic jobs (Celery beat)."""

import asyncio

from app.core.celery import celery_app
from app.core.logging import get_logger

logger = get_logger("community_tasks")


@celery_app.task(name="tasks.flush_community_views")
def flush_community_views() -> int:
    """Drain Redis-batched topic views into view_count once a minute —
    a view is a counter tick, never a per-request Postgres write."""
    from app.services.community_service import flush_views

    flushed = asyncio.run(flush_views())
    if flushed:
        logger.info("community_views_flushed", count=flushed)
    return flushed
