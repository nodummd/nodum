"""Collab websocket endpoint — Yjs sync protocol per note."""

from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, status
from pycrdt.websocket.websocket import HttpxWebsocket

from app.core.collab import collab_server, room_name
from app.core.custom_exceptions import UnauthorizedError
from app.core.logging import get_logger
from app.dependencies.auth import validate_access_token
from app.settings import get_settings

router = APIRouter()
logger = get_logger("collab")


@router.websocket("/vaults/{vault_id}/notes/{note_id}/collab")
async def collab_ws(websocket: WebSocket, vault_id: UUID, note_id: UUID, token: str = Query(default="")) -> None:
    """Serve a Yjs client for one note.

    Auth: short-lived access token as a query parameter (browsers cannot set
    headers on websocket upgrades). Ownership is enforced before accept.
    """
    if not get_settings().COLLAB_ENABLED:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Collaboration disabled")
        return

    try:
        user_id = await validate_access_token(token)
    except UnauthorizedError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Unauthorized")
        return

    from sqlalchemy import select

    from app.core.db import async_session_factory
    from app.models.vaults import Note, Vault

    async with async_session_factory() as db:
        owned = await db.scalar(
            select(Note.id)
            .join(Vault, Vault.id == Note.vault_id)
            .where(Note.id == note_id, Note.vault_id == vault_id, Vault.user_id == user_id)
        )
    if owned is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Not found")
        return

    await websocket.accept()
    try:
        await collab_server.serve(HttpxWebsocket(websocket, room_name(vault_id, note_id)))
    except Exception as e:
        subs = getattr(e, "exceptions", None)
        detail = "; ".join(repr(x) for x in subs) if subs else repr(e)
        logger.info("collab_client_disconnected", error=detail)
