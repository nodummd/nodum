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

    logger.info("app_started")
    yield

    logger.info("app_shutting_down")
    from app.core.redis import close_redis

    await close_redis()
    logger.info("app_stopped")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
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

    register_exception_handlers(app)

    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    async def health_check() -> Any:
        """Deep health check verifying database and Redis connectivity."""
        from sqlalchemy import text

        from app.core.db import async_session_factory
        from app.core.redis import redis_client

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
