"""Long-lived API tokens (the MCP credential): mint, list, revoke, verify.

The plaintext is `nodum_<kind>_<43 urlsafe chars>` — the prefix so a leaked one
is recognisable in a log or a secret scanner, the rest 256 bits of CSPRNG. Only
its SHA-256 is stored.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import ApiToken
from app.services.service_response import ServiceResponse

MAX_TOKENS_PER_USER = 10
_TOUCH_INTERVAL = timedelta(minutes=1)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public(token: ApiToken) -> dict[str, Any]:
    return {
        "id": str(token.id),
        "kind": token.kind,
        "name": token.name,
        "hint": token.hint,
        "created_at": token.created_at.isoformat() if token.created_at else None,
        "last_used_at": token.last_used_at.isoformat() if token.last_used_at else None,
        "revoked_at": token.revoked_at.isoformat() if token.revoked_at else None,
    }


async def list_tokens(db: AsyncSession, user_id: UUID, kind: str = "mcp") -> ServiceResponse[list[dict[str, Any]]]:
    rows = (
        await db.execute(
            select(ApiToken)
            .where(ApiToken.user_id == user_id, ApiToken.kind == kind)
            .order_by(ApiToken.created_at.desc())
        )
    ).scalars()
    return ServiceResponse.ok([_public(t) for t in rows])


async def create_token(
    db: AsyncSession, user_id: UUID, *, name: str, kind: str = "mcp"
) -> ServiceResponse[dict[str, Any]]:
    """Mint a token. The plaintext is in the response exactly once."""
    name = (name or "").strip()[:100] or "MCP client"
    live = (
        (
            await db.execute(
                select(ApiToken).where(
                    ApiToken.user_id == user_id, ApiToken.kind == kind, ApiToken.revoked_at.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    if len(live) >= MAX_TOKENS_PER_USER:
        return ServiceResponse.fail(
            "validation_failed", f"You already have {MAX_TOKENS_PER_USER} active tokens — revoke one first."
        )
    plaintext = f"nodum_{kind}_{secrets.token_urlsafe(32)}"
    row = ApiToken(user_id=user_id, kind=kind, name=name, token_hash=_hash(plaintext), hint=plaintext[-4:])
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ServiceResponse.ok({**_public(row), "token": plaintext})


async def revoke_token(db: AsyncSession, user_id: UUID, token_id: UUID) -> ServiceResponse[dict[str, Any]]:
    row = await db.scalar(select(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == user_id))
    if row is None:
        return ServiceResponse.fail("not_found", "Token not found.")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        await db.commit()
    return ServiceResponse.ok(_public(row))


async def verify_token(db: AsyncSession, plaintext: str, *, kind: str = "mcp") -> UUID | None:
    """The user a live token belongs to, or None. Touches last_used_at at most
    once a minute — a chatty client should not turn every call into a write."""
    if not plaintext or not plaintext.startswith(f"nodum_{kind}_"):
        return None
    row = await db.scalar(
        select(ApiToken).where(
            ApiToken.token_hash == _hash(plaintext), ApiToken.kind == kind, ApiToken.revoked_at.is_(None)
        )
    )
    if row is None:
        return None
    now = datetime.now(UTC)
    if row.last_used_at is None or now - row.last_used_at > _TOUCH_INTERVAL:
        row.last_used_at = now
        await db.commit()
    return row.user_id
