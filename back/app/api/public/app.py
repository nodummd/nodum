"""The public API — a separate FastAPI app mounted at /api/public/v1.

Separate on purpose: it gets its own OpenAPI document containing only these
endpoints (which is what the reference docs render), its own bearer-key auth,
and a surface that can stay stable while the app API moves.

Three things a mounted sub-app does NOT inherit, and how each is handled:
- exception handlers — registered again here, same envelope;
- lifespan — this app has none; it only uses the global engine/Redis the
  parent's lifespan initialises;
- (middleware IS inherited: rate limiting, body size, gzip, logging all run
  before the mount routes.)

NB: distinct from the pre-existing unauthenticated /api/v1/public/... publish
routes — different prefix, different job.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.exceptions import register_exception_handlers
from app.api.public.routers import ai, attachments, graph, links, notes, search, tags, vaults
from app.api.public.schemas import ErrorResponse
from app.settings import get_settings

_DESCRIPTION = """\
Drive your Nodum vaults from any language over plain REST.

## Authentication

Create a key in **Settings → API keys** and send it on every request:

```
Authorization: Bearer nodum_key_…
```

A key can do only what its **scopes** allow — `read`, `write`, `delete`, `ai` —
and only inside its owner's vaults. Changing or resetting your password
revokes every key.

## The 60-second start

```bash
curl -H "Authorization: Bearer $NODUM_KEY" \\
  https://your-nodum/api/public/v1/vaults
```

Take a vault `id` from the answer, then search it, read a note, create one.

## Conventions

- Success is `{"data": ...}`; every error is `{"error": {"code", "message"}}`
  with a stable `code` (`not_found`, `forbidden`, `conflict`, …).
- Anything of yours that does not exist — and anything that is not yours —
  is the same `404`.
- Note lists and search take `limit` + `offset` and return `total`; capped
  collections (tags, attachments, quick-switch) return whole or top-N.
- Notes are addressed by id; `by-path` reads by exact path; link targets
  accept an id, a path (`"Projects/Alpha"`) or an exact title.
- Requests are rate-limited per key (300/minute by default).
"""

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Missing, unknown or revoked API key."},
    404: {"model": ErrorResponse, "description": "Not there — or not yours; deliberately the same answer."},
    422: {"model": ErrorResponse, "description": "Validation failed."},
}
_FORBIDDEN: dict[int | str, dict[str, Any]] = {
    403: {"model": ErrorResponse, "description": "The key lacks a required scope."},
}


def create_public_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Nodum API",
        version=settings.APP_VERSION,
        description=_DESCRIPTION,
        servers=[{"url": "/api/public/v1"}],
        swagger_ui_parameters={"persistAuthorization": True},
        # No lifespan: it would never fire under a mount (see app/main.py).
    )
    register_exception_handlers(app)

    # Starlette's own 404 (unknown path) and 405 (wrong method) bypass the
    # NodumError handlers and would answer {"detail": ...} — keep the envelope.
    @app.exception_handler(StarletteHTTPException)
    async def _plain_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, f"http_{exc.status_code}")
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": code, "message": str(exc.detail)}})

    app.include_router(vaults.router, prefix="/vaults", tags=["Vaults"], responses={**_ERRORS, **_FORBIDDEN})
    app.include_router(
        notes.router, prefix="/vaults/{vault_id}/notes", tags=["Notes"], responses={**_ERRORS, **_FORBIDDEN}
    )
    app.include_router(search.router, prefix="/vaults/{vault_id}", tags=["Search"], responses={**_ERRORS, **_FORBIDDEN})
    app.include_router(
        links.router, prefix="/vaults/{vault_id}/notes", tags=["Links"], responses={**_ERRORS, **_FORBIDDEN}
    )
    app.include_router(
        tags.router, prefix="/vaults/{vault_id}/tags", tags=["Tags"], responses={**_ERRORS, **_FORBIDDEN}
    )
    app.include_router(graph.router, prefix="/vaults/{vault_id}", tags=["Graph"], responses={**_ERRORS, **_FORBIDDEN})
    app.include_router(
        attachments.router,
        prefix="/vaults/{vault_id}/attachments",
        tags=["Attachments"],
        responses={**_ERRORS, **_FORBIDDEN},
    )
    app.include_router(ai.router, prefix="/vaults/{vault_id}/ai", tags=["AI"], responses={**_ERRORS, **_FORBIDDEN})
    return app


# Module-level so tests can target it with dependency_overrides.
public_app = create_public_app()
