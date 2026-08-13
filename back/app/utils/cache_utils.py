"""Redis JSON cache helpers with fail-open semantics.

Redis being down must never break reads — helpers return None / no-op on
connection errors and the caller falls through to the database.
"""

import json
from typing import Any

from app.core.logging import get_logger
from app.core.redis import redis_client

logger = get_logger("cache")


def vault_tree_key(vault_id: Any) -> str:
    return f"tree:v3:{vault_id}"


def vault_graph_key(vault_id: Any) -> str:
    return f"graph:v3:{vault_id}"


async def cache_get_json(key: str) -> Any | None:
    """Fetch and decode a cached JSON value; None on miss or Redis failure."""
    try:
        raw = await redis_client.get(key)
    except Exception:
        logger.warning("cache_get_failed", key=key)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    """Store a JSON-encodable value with a TTL; no-op on Redis failure."""
    try:
        await redis_client.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception:
        logger.warning("cache_set_failed", key=key)


async def cache_delete(*keys: str) -> None:
    """Invalidate cache keys; no-op on Redis failure."""
    if not keys:
        return
    try:
        await redis_client.delete(*keys)
    except Exception:
        logger.warning("cache_delete_failed", keys=list(keys))
