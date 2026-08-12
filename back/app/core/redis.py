"""Shared async Redis client."""

import redis.asyncio as aioredis

from app.settings import get_settings

settings = get_settings()


def control_url_from(cache_url: str) -> str:
    """Default control-plane URL: same server, logical DB 3.

    (DB 0 = cache, 1 = celery broker, 2 = celery results, 3 = control.)
    """
    base, sep, db = cache_url.rpartition("/")
    if sep and db.isdigit():
        return f"{base}/3"
    return f"{cache_url.rstrip('/')}/3"


# Cache blobs — safe to evict (allkeys-lru); TTL'd JSON payloads only.
redis_client: aioredis.Redis = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
    max_connections=50,
)

# Control plane — rate-limit counters, token revocation markers, refresh
# grace keys. These are correctness/security state and must never be
# evicted with the cache; a separate logical DB (or a dedicated instance
# via REDIS_CONTROL_URL) keeps them apart.
redis_control: aioredis.Redis = aioredis.from_url(
    settings.REDIS_CONTROL_URL or control_url_from(settings.REDIS_URL),
    encoding="utf-8",
    decode_responses=True,
    max_connections=20,
)


async def close_redis() -> None:
    """Close the Redis connection pools on shutdown."""
    await redis_client.aclose()
    await redis_control.aclose()
