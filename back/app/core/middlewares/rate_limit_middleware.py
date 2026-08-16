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
from app.core.redis import redis_control
from app.settings import CommonSettings, get_settings
from app.utils.jwt_utils import decode_token

logger = get_logger("rate_limit")

AUTH_PREFIX = "/api/v1/auth"
EXEMPT_PATHS = ("/health", "/docs", "/openapi.json", "/redoc")


def client_ip_from(request: Request, settings: CommonSettings) -> str:
    """Resolve the client address, trusting X-Forwarded-For only as configured.

    X-Forwarded-For is a chain the client can seed: a proxy *appends* the peer
    it received from, so a request arriving as ``X-Forwarded-For: 1.2.3.4``
    reaches us as ``1.2.3.4, <real client>``. Reading the leftmost entry — as
    this used to — therefore hands the attacker their own rate-limit bucket
    per forged value, which is an outright bypass of the auth brute-force
    limit rather than a hardening gap.

    Counting from the right is safe under both proxy conventions: appending
    proxies leave the real client at ``-TRUSTED_PROXY_HOPS``, and replacing
    proxies (nginx ``proxy_set_header X-Forwarded-For $remote_addr``) leave a
    single entry that the same index selects.
    """
    direct = request.client.host if request.client else "unknown"
    if not settings.TRUST_PROXY_HEADERS:
        return direct

    hops = [hop.strip() for hop in request.headers.get("X-Forwarded-For", "").split(",") if hop.strip()]
    trusted = max(settings.TRUSTED_PROXY_HOPS, 1)
    if len(hops) < trusted:
        # Shorter chain than configured: either a hop was stripped or the
        # setting is wrong. Either way every remaining entry is client-writable,
        # so fall back to the socket address rather than trust one.
        return direct
    return hops[-trusted]


def _authenticated_user(request: Request) -> str | None:
    """User id from a valid bearer token, or None.

    The middleware runs before routing, so the auth dependency has not resolved
    yet; verifying the token here costs one HMAC. Without this the limiter keys
    every authenticated request on IP, and the whole office behind one NAT — or
    the entire deployment behind one reverse proxy — shares a single bucket,
    which is what the module docstring already promised it did not do.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    payload = decode_token(token.strip(), "access")
    return str(payload["sub"]) if payload and payload.get("sub") else None


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Fixed-window rate limiter keyed by user id, falling back to client IP."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if path.startswith(EXEMPT_PATHS) or request.method == "OPTIONS":
            return await call_next(request)

        settings = get_settings()
        # Rate limiting is a production concern; dev/test iterate too fast for it.
        if settings.ENVIRONMENT in ("dev", "test"):
            return await call_next(request)

        client_ip = client_ip_from(request, settings)

        if path.startswith(AUTH_PREFIX) and request.method == "POST":
            # Always per-IP: these endpoints are what an attacker hits *before*
            # holding a token, so there is no user to key on.
            key = f"rl:auth:{client_ip}"
            limit = settings.RATE_LIMIT_AUTH_REQUESTS
            window = settings.RATE_LIMIT_AUTH_WINDOW_SECONDS
        else:
            # Per-user where possible so one shared egress IP cannot exhaust
            # everyone else's budget; per-IP only for anonymous traffic.
            user_id = _authenticated_user(request)
            key = f"rl:api:u:{user_id}" if user_id else f"rl:api:ip:{client_ip}"
            limit = settings.USER_RATE_LIMIT_REQUESTS_PER_MINUTE
            window = settings.USER_RATE_LIMIT_WINDOW_SECONDS

        try:
            count = await redis_control.incr(key)
            if count == 1:
                await redis_control.expire(key, window)
            if count > limit:
                ttl = await redis_control.ttl(key)
                return JSONResponse(
                    status_code=429,
                    content={"error": {"code": "rate_limited", "message": "Too many requests."}},
                    headers={"Retry-After": str(max(ttl, 1))},
                )
        except Exception:  # Redis down — fail open
            logger.warning("rate_limit_redis_unavailable")

        return await call_next(request)
