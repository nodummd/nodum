"""OpenAPI metadata configuration."""

from typing import Any

from app.settings import get_settings


def get_openapi_config() -> dict[str, Any]:
    """Return title/version/description for the FastAPI app."""
    settings = get_settings()
    return {
        "title": f"{settings.APP_NAME} API",
        "version": settings.APP_VERSION,
        "description": (
            "Nodum — open-source web knowledge base. Linked markdown notes, "
            "backlinks, and an interactive knowledge graph.\n\n"
            "All endpoints are versioned under `/api/v1`. Responses use a "
            '`{"data": ...}` envelope; errors use `{"error": {"code", "message"}}`.'
        ),
    }
