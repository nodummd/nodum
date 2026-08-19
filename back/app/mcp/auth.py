"""Bearer-token gate in front of the MCP endpoint.

MCP clients are other programs, not browsers: no cookie, no refresh flow, one
long-lived token pasted in once (Settings → MCP). This ASGI wrapper checks it
before a single byte reaches the protocol handler and stamps the user onto the
request scope, where every tool reads it back. A wrong or revoked token gets a
401 with `WWW-Authenticate: Bearer` — the standard signal, and the one
`mcp-remote` and the Claude / Cursor clients report legibly.
"""

from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.core.db import async_session_factory
from app.services import api_token_service

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

USER_ID_KEY = "nodum_user_id"


async def _reject(send: Send, status: int, body: bytes) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", b'Bearer realm="nodum-mcp"'),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BearerTokenGate:
    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        header = ""
        for name, value in scope.get("headers", []):
            if name.lower() == b"authorization":
                header = value.decode("latin-1")
                break
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            await _reject(
                send,
                401,
                b'{"error":{"code":"unauthorized","message":"Send your MCP token as: Authorization: Bearer <token>. Mint one in Settings -> MCP."}}',
            )
            return
        async with async_session_factory() as db:
            user_id = await api_token_service.verify_token(db, token.strip())
        if user_id is None:
            await _reject(
                send,
                401,
                b'{"error":{"code":"unauthorized","message":"That MCP token is unknown or has been revoked."}}',
            )
            return
        scope.setdefault("state", {})[USER_ID_KEY] = user_id
        await self.app(scope, receive, send)
