"""Bearer-key authentication and scope enforcement for the public API.

The dependency does three things per request: resolves the `nodum_key_…`
bearer to a user, enforces the route's scopes, and drops the verified-marker
so the rate limiter gives this key its own bucket. Using ``Security(...)``
(not ``Depends``) is what emits the OpenAPI security scheme — the padlocks in
the reference docs, and what lets Scalar prefill the Authorization header.

Scopes are enforced here and ONLY here — never in the service layer, which is
shared with the session-authenticated app and must stay unrestricted there.
"""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.constants.scopes import API_SCOPES
from app.core.custom_exceptions import ForbiddenError, UnauthorizedError
from app.dependencies.db import SessionDep
from app.services import api_token_service

bearer_scheme = HTTPBearer(
    scheme_name="ApiKey",
    bearerFormat="nodum_key_…",
    description="An API key from **Settings → API keys**, sent as `Authorization: Bearer nodum_key_…`.",
    # We raise our own 401 so the error envelope matches the rest of the API.
    auto_error=False,
)


def require_scopes(*needed: str):
    unknown = set(needed) - API_SCOPES
    assert not unknown, f"unknown scopes: {unknown}"

    async def _dep(
        creds: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_scheme)],
        db: SessionDep,
    ) -> UUID:
        token = (creds.credentials if creds else "").strip()
        if not token.startswith("nodum_key_"):
            # Sessions belong on /api/v1 and MCP tokens on /api/v1/mcp; say
            # which credential this API wants without confirming what was sent.
            raise UnauthorizedError(
                "Send an API key as: Authorization: Bearer nodum_key_… — create one in Settings → API keys."
            )
        ident = await api_token_service.verify_token(db, token, kind="key")
        if ident is None:
            raise UnauthorizedError("That API key is unknown or has been revoked.")
        missing = sorted(set(needed) - ident.scopes)
        if missing:
            raise ForbiddenError(f"This key does not have the '{missing[0]}' scope.")
        # Give a *valid* key its own rate-limit bucket (a made-up one stays
        # on the caller's per-IP bucket).
        await api_token_service.mark_verified(token)
        return ident.user_id

    return _dep


ReadUser = Annotated[UUID, Depends(require_scopes("read"))]
WriteUser = Annotated[UUID, Depends(require_scopes("write"))]
DeleteUser = Annotated[UUID, Depends(require_scopes("delete"))]
AiUser = Annotated[UUID, Depends(require_scopes("ai"))]
