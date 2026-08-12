"""Redis-backed rate limiting middleware.

Two tiers:
- Auth endpoints (/api/v1/auth/*): strict per-IP limit (brute-force protection).
- Everything else: generous per-user (or per-IP when anonymous) limit.

Uses a fixed-window counter (INCR + EXPIRE) — cheap and O(1) per request.
Fails open if Redis is unavailable so the API never hard-depends on Redis.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.logging import get_logger
from app.core.redis import redis_client
from app.settings import get_settings

logger = get_logger("rate_limit")

AUTH_PREFIX = "/api/v1/auth"
EXEMPT_PATHS = ("/health", "/docs", "/openapi.json", "/redoc")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Fixed-window rate limiter keyed by user id (from auth dep) or client IP."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if path.startswith(EXEMPT_PATHS) or request.method == "OPTIONS":
            return await call_next(request)

        settings = get_settings()
        # Rate limiting is a production concern; dev/test iterate too fast for it.
        if settings.ENVIRONMENT in ("dev", "test"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        if settings.TRUST_PROXY_HEADERS:
            forwarded = request.headers.get("X-Forwarded-For", "")
            if forwarded:
                client_ip = forwarded.split(",")[0].strip() or client_ip

        if path.startswith(AUTH_PREFIX) and request.method == "POST":
            key = f"rl:auth:{client_ip}"
            limit = settings.RATE_LIMIT_AUTH_REQUESTS
            window = settings.RATE_LIMIT_AUTH_WINDOW_SECONDS
        else:
            key = f"rl:api:{client_ip}"
            limit = settings.USER_RATE_LIMIT_REQUESTS_PER_MINUTE
            window = settings.USER_RATE_LIMIT_WINDOW_SECONDS

        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, window)
            if count > limit:
                ttl = await redis_client.ttl(key)
                return JSONResponse(
                    status_code=429,
                    content={"error": {"code": "rate_limited", "message": "Too many requests."}},
                    headers={"Retry-After": str(max(ttl, 1))},
                )
        except Exception:  # Redis down — fail open
            logger.warning("rate_limit_redis_unavailable")

        return await call_next(request)
