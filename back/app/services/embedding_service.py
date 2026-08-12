"""Pluggable note embeddings for semantic similarity.

Providers (EMBEDDINGS_PROVIDER):
    hash    (default) — deterministic hashed bag-of-words, 384 dims, zero
            dependencies, runs in microseconds. Cosine similarity over it is
            classic tf-hashing similarity: solid "related notes" without any
            model. Works fully offline.
    openai  — text-embedding-3-small with dimensions=384 (needs
            OPENAI_API_KEY); drop-in upgrade, same column.

The vector column is dimension-fixed at 384 for both providers.
"""

import hashlib
import math
import re

import httpx

from app.core.logging import get_logger
from app.settings import get_settings

logger = get_logger("embeddings")

EMBEDDING_DIM = 384

_TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)


def _hash_embed(text: str) -> list[float]:
    """Hashing-trick tf vector, l2-normalized."""
    vector = [0.0] * EMBEDDING_DIM
    tokens = _TOKEN_RE.findall(text.lower())
    if not tokens:
        return vector
    for token in tokens:
        digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % EMBEDDING_DIM
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(v * v for v in vector))
    if norm > 0:
        vector = [v / norm for v in vector]
    return vector


async def _openai_embed(text: str) -> list[float] | None:
    settings = get_settings()
    api_key = getattr(settings, "OPENAI_API_KEY", "") or ""
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "text-embedding-3-small",
                    "input": text[:8000],
                    "dimensions": EMBEDDING_DIM,
                },
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
    except Exception:
        logger.warning("openai_embedding_failed_falling_back_to_hash")
        return None


async def embed_text(text: str) -> list[float]:
    """Embed a note's text with the configured provider (hash fallback always works)."""
    settings = get_settings()
    provider = getattr(settings, "EMBEDDINGS_PROVIDER", "hash") or "hash"
    if provider == "openai":
        result = await _openai_embed(text)
        if result is not None:
            return result
    return _hash_embed(text)
