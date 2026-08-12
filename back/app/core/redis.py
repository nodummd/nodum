"""Shared async Redis client."""

import redis.asyncio as aioredis

from app.settings import get_settings

settings = get_settings()

redis_client: aioredis.Redis = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
    max_connections=50,
)


async def close_redis() -> None:
    """Close the Redis connection pool on shutdown."""
    await redis_client.aclose()
