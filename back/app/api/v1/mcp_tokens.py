"""MCP tokens — the credential an AI client sends to /api/v1/mcp.

Session-authenticated (this is the settings screen); the tokens themselves are
minted here, shown once, listed with a hint, and revoked. The MCP endpoint
itself is mounted separately (app/mcp) and never touches the session.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import api_token_service
from app.settings import get_settings

router = APIRouter()


class TokenCreateRequest(BaseModel):
    name: str = Field(default="", max_length=100)


@router.get("")
async def list_tokens(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Your MCP tokens (never the token values) plus the endpoint URL to configure."""
    tokens = (await api_token_service.list_tokens(db, user_id)).unwrap()
    # The MCP endpoint lives beside the API on the site's public origin — the
    # one the app itself is served from (FRONTEND_BASE_URL, required in every
    # deployment; in dev it is the Next origin, whose rewrite proxies /api).
    # Not the request's headers: X-Forwarded-Proto is whatever the last hop
    # says, which behind an upstream TLS terminator is "http".
    origin = get_settings().FRONTEND_BASE_URL.rstrip("/")
    return {"data": {"tokens": tokens, "endpoint": f"{origin}/api/v1/mcp"}}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_token(body: TokenCreateRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Mint a token. The plaintext is in this response and nowhere else, ever."""
    return {"data": (await api_token_service.create_token(db, user_id, name=body.name)).unwrap()}


@router.delete("/{token_id}")
async def revoke_token(token_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Revoke a token — clients holding it stop working on their next call."""
    return {"data": (await api_token_service.revoke_token(db, user_id, token_id)).unwrap()}
