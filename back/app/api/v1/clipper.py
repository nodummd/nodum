"""Web Clipper endpoints — token management (session-authed) and clipping.

The clip endpoint authenticates with the clipper token rather than the session,
because a browser extension has neither the refresh cookie nor a same-origin
context. Since it is header-authenticated and never cookie-authenticated, a
malicious page cannot ride the user's session into it — so it can safely accept
cross-origin requests from an extension.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, Field

from app.core.custom_exceptions import UnauthorizedError
from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import clipper_service

router = APIRouter()


class ClipRequest(BaseModel):
    url: str = Field(max_length=2048)
    title: str = Field(default="Untitled clip", max_length=500)
    markdown: str = Field(default="", max_length=2_000_000)
    vault_id: UUID | None = None
    folder: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=30)


@router.post("/token", status_code=status.HTTP_201_CREATED)
async def issue_clipper_token(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Mint (or rotate) the clipper token. The plaintext is returned once."""
    data = (await clipper_service.issue_token(db, user_id)).unwrap()
    return {"data": data}


@router.get("/token")
async def clipper_token_status(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    return {"data": {"configured": await clipper_service.has_token(db, user_id)}}


@router.delete("/token", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_clipper_token(user_id: CurrentUserId, db: SessionDep) -> Response:
    (await clipper_service.revoke_token(db, user_id)).unwrap()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/clip", status_code=status.HTTP_201_CREATED)
async def clip_page(
    body: ClipRequest,
    db: SessionDep,
    x_nodum_token: str = Header(default=""),
) -> dict[str, Any]:
    """Create a note from a captured page. Authenticated by the clipper token."""
    user = await clipper_service.user_for_token(db, x_nodum_token)
    if user is None:
        raise UnauthorizedError("Invalid or missing clipper token.")
    data = (
        await clipper_service.clip(
            db,
            user,
            url=body.url,
            title=body.title,
            markdown=body.markdown,
            vault_id=body.vault_id,
            folder=body.folder,
            tags=body.tags,
        )
    ).unwrap()
    return {"data": data}


@router.get("/vaults")
async def clipper_vaults(db: SessionDep, x_nodum_token: str = Header(default="")) -> dict[str, Any]:
    """Vault list for the extension's picker — token-authed, no session."""
    from sqlalchemy import select

    from app.models.vaults import Vault

    user = await clipper_service.user_for_token(db, x_nodum_token)
    if user is None:
        raise UnauthorizedError("Invalid or missing clipper token.")
    rows = await db.execute(select(Vault).where(Vault.user_id == user.id).order_by(Vault.created_at))
    return {"data": [{"id": str(v.id), "name": v.name} for v in rows.scalars()]}
