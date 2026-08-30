"""Connected data sources — connect, inspect, sync, disconnect."""

from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

from app.core.custom_exceptions import NotFoundError, ValidationFailedError
from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import provider_connection_service, providers
from app.services.providers import google_auth
from app.settings import get_settings

router = APIRouter()


@router.get("/providers")
async def list_providers(_user_id: CurrentUserId) -> dict[str, Any]:
    """The catalogue of syncable sources, and whether this instance offers each."""
    return {
        "data": {
            "configured": google_auth.sync_enabled(),
            "providers": providers.catalog(),
        }
    }


@router.get("/connections")
async def list_connections(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    data = (await provider_connection_service.list_for_user(db, user_id)).unwrap()
    return {"data": data}


@router.post("/google/start")
async def start_google(
    user_id: CurrentUserId,
    vault_id: UUID,
    provider: str = Query(description="google_calendar or google_gmail"),
) -> dict[str, Any]:
    """Begin the consent flow. Returns the URL for the browser to visit."""
    if not google_auth.sync_enabled():
        raise ValidationFailedError(
            "Google sync is not configured on this server. An administrator needs to set "
            "GOOGLE_SYNC_CLIENT_ID and GOOGLE_SYNC_CLIENT_SECRET — see docs/OWNER-SETUP.md."
        )
    adapter = providers.get_adapter(provider)
    if adapter is None:
        entry = providers.registry_entry(provider)
        if entry is not None:
            raise ValidationFailedError(
                f"{entry.adapter.name} is not enabled on this server. It requires scopes that "
                "oblige a hosted service to carry a paid annual security audit, so it is "
                "available on self-hosted instances only."
            )
        raise NotFoundError("Unknown provider.")

    url = await google_auth.build_start_url(user_id=str(user_id), vault_id=str(vault_id), scopes=list(adapter.scopes))
    return {"data": {"url": url, "provider": provider}}


@router.get("/google/callback")
async def google_callback(
    db: SessionDep,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
) -> RedirectResponse:
    """Google redirects here. Always lands the user back in the app.

    Unauthenticated by necessity — Google drives this request, not the SPA — so
    the `state` token is the only thing binding the callback to the user who
    started it, and it is single-use.
    """
    base = get_settings().OAUTH_REDIRECT_BASE_URL.rstrip("/")

    def back(status: str, detail: str = "") -> RedirectResponse:
        suffix = f"&detail={quote(detail, safe='')}" if detail else ""
        return RedirectResponse(f"{base}/vault?connected={status}{suffix}", status_code=303)

    if error or not code or not state:
        return back("denied")

    resolved = await google_auth.consume_state(state)
    if resolved is None:
        return back("expired")
    user_id, vault_id = resolved

    response = await provider_connection_service.complete_google_connect(
        db, user_id=UUID(user_id), vault_id=UUID(vault_id), code=code
    )
    return back("ok") if response.success else back("failed", response.error_code)


@router.post("/connections/{connection_id}/sync")
async def sync_now(connection_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Run this connection immediately rather than waiting for the next tick."""
    data = (await provider_connection_service.sync_now(db, connection_id, user_id)).unwrap()
    return {"data": data}


@router.patch("/connections/{connection_id}")
async def update_connection(
    connection_id: UUID, settings: dict[str, Any], user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    data = (await provider_connection_service.update_settings(db, connection_id, user_id, settings)).unwrap()
    return {"data": data}


@router.delete("/connections/{connection_id}")
async def disconnect(connection_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    data = (await provider_connection_service.disconnect(db, connection_id, user_id)).unwrap()
    return {"data": data}
