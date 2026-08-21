"""API keys — the credential an external application sends to /api/public/v1.

Session-authenticated (this is the settings screen); the keys themselves are
minted here, shown once, listed with a hint, and revoked. The public API they
unlock is a separate FastAPI app mounted in app/main.py and never touches the
session.
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


class KeyCreateRequest(BaseModel):
    name: str = Field(default="", max_length=100)
    scopes: list[str] = Field(default_factory=list)


def _base_url() -> str:
    # The public origin the app is served from (see mcp_tokens.py for why
    # this is FRONTEND_BASE_URL and not the request's forwarded headers).
    origin = get_settings().FRONTEND_BASE_URL.rstrip("/")
    return f"{origin}/api/public/v1"


@router.get("")
async def list_keys(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Your API keys (never the key values) plus the base URL to call."""
    keys = (await api_token_service.list_tokens(db, user_id, kind="key")).unwrap()
    return {"data": {"keys": keys, "base_url": _base_url()}}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_key(body: KeyCreateRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Mint a key. The plaintext is in this response and nowhere else, ever."""
    created = (
        await api_token_service.create_token(db, user_id, name=body.name, kind="key", scopes=body.scopes)
    ).unwrap()
    return {"data": {**created, "base_url": _base_url()}}


@router.delete("/{key_id}")
async def revoke_key(key_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Revoke a key — applications holding it stop working on their next call."""
    return {"data": (await api_token_service.revoke_token(db, user_id, key_id)).unwrap()}
