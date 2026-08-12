"""Background jobs for vault import/export (implemented in feature/import-export)."""

from app.core.celery import celery_app


@celery_app.task(name="tasks.ping")
def ping() -> str:
    """Health-check task used to verify the worker is alive."""
    return "pong"
