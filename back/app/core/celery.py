"""Celery application for background jobs (import/export, heavy scans)."""

from celery import Celery

from app.settings import get_settings

settings = get_settings()

celery_app = Celery(
    "nodum",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.vault_io", "app.tasks.maintenance", "app.tasks.community"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_time_limit=300,
    task_soft_time_limit=240,
    worker_prefetch_multiplier=1,
    # Beat schedule (worker runs with -B): nightly session pruning
    beat_schedule={
        "prune-sessions-nightly": {
            "task": "tasks.prune_sessions",
            "schedule": 24 * 60 * 60.0,
        },
        "flush-community-views": {
            "task": "tasks.flush_community_views",
            "schedule": 60.0,
        },
    },
)
