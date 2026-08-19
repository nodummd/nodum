"""FastAPI application factory with lifespan management."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.gzip import GZipMiddleware

from app.api.exceptions import register_exception_handlers
from app.api.v1.router import api_router
from app.core.logging import get_logger, setup_logging
from app.core.middlewares.body_size_middleware import MaxBodySizeMiddleware
from app.core.middlewares.cors_middleware import add_cors_middleware
from app.core.middlewares.logging_middleware import LoggingMiddleware
from app.core.middlewares.rate_limit_middleware import RateLimitMiddleware
from app.core.middlewares.security_headers_middleware import SecurityHeadersMiddleware
from app.core.openapi import get_openapi_config
from app.settings import get_settings

logger = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan — startup and shutdown hooks."""
    settings = get_settings()

    setup_logging()
    logger.info("app_starting", environment=settings.ENVIRONMENT)

    # Ensure S3 bucket exists (boto3 is synchronous — run in a thread)
    from app.core.s3 import ensure_buckets_exist

    try:
        await asyncio.to_thread(ensure_buckets_exist)
    except Exception as e:
        logger.warning("s3_bucket_init_failed", error=str(e))

    from app.core.collab import collab_server

    if settings.COLLAB_ENABLED:
        await collab_server.startup()

    # The MCP transport's session manager must be running for the whole life
    # of the app; a mounted sub-app's own lifespan never fires under FastAPI.
    from app.mcp.server import server as mcp_server

    async with mcp_server.session_manager.run():
        logger.info("app_started")
        yield

    if settings.COLLAB_ENABLED:
        await collab_server.shutdown()

    logger.info("app_shutting_down")
    from app.core.redis import close_redis

    await close_redis()
    logger.info("app_stopped")


def _init_sentry() -> None:
    """Wire up error reporting when a DSN is configured.

    sentry-sdk has been a declared dependency and SENTRY_DSN has been plumbed
    through prod compose since the beginning, but nothing ever called init() —
    so production has been silently reporting nothing.

    PII stays off deliberately: this app's request bodies *are* the user's
    private notes, and shipping them to a third party to debug a 500 would be
    a worse bug than the 500.
    """
    settings = get_settings()
    if not settings.SENTRY_DSN:
        return

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
        max_request_body_size="never",
    )
    logger.info("sentry_initialised", environment=settings.ENVIRONMENT)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    # Before anything else: an exception raised while building the app should
    # still be reported.
    _init_sentry()

    openapi_config = get_openapi_config()

    app = FastAPI(
        title=openapi_config["title"],
        version=openapi_config["version"],
        description=openapi_config["description"],
        lifespan=lifespan,
        swagger_ui_parameters={"persistAuthorization": True},
    )

    # Middleware stack (added in reverse execution order)
    # Execution order: SecurityHeaders → CORS → GZip → Logging → RateLimit
    add_cors_middleware(app)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(RateLimitMiddleware)
    # Added last, so it is the outermost layer and an oversized body is
    # rejected before any other middleware — or the multipart parser — sees it.
    app.add_middleware(MaxBodySizeMiddleware)

    register_exception_handlers(app)

    app.include_router(api_router, prefix="/api/v1")

    # Nodum as an MCP server — bearer-token gated, Streamable HTTP, JSON
    # responses. Under /api so the web app's proxy and the production reverse
    # proxy both carry it without extra routes.
    from starlette.routing import Route

    from app.mcp.server import MCP_PATH, mcp_app

    app.router.routes.append(Route(MCP_PATH, endpoint=mcp_app, include_in_schema=False))

    @app.get("/health", tags=["Health"])
    async def health_check() -> Any:
        """Deep health check verifying database and Redis connectivity."""
        from sqlalchemy import text

        from app.core.db import async_session_factory
        from app.core.redis import redis_client, redis_control

        checks: dict[str, str] = {}
        overall = "healthy"

        try:
            async with async_session_factory() as session:
                await session.execute(text("SELECT 1"))
            checks["postgres"] = "healthy"
        except Exception:
            checks["postgres"] = "degraded"
            overall = "degraded"

        try:
            await redis_client.ping()
            await redis_control.ping()
            checks["redis"] = "healthy"
        except Exception:
            checks["redis"] = "degraded"
            overall = "degraded"

        return JSONResponse(
            content={
                "status": overall,
                "version": openapi_config["version"],
                "environment": get_settings().ENVIRONMENT,
                "checks": checks,
            },
            status_code=200 if overall == "healthy" else 503,
        )

    return app


app = create_app()
