"""The public API's error envelope.

Every failure answers with the same three fields, whatever raised it:

    {"ok": false, "error": {"code", "details", "message"}}

`code` is SCREAMING_SNAKE and stable — clients branch on it. `message` is
the short human line. `details` carries the specifics (which field, which
scope, what conflicted) and falls back to `message` when there are none, so
the shape never changes shape under a client.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.custom_exceptions import NodumError
from app.core.logging import get_logger

logger = get_logger("public_api")

# Starlette raises these itself, before any of our code runs.
_HTTP_CODES: dict[int, str] = {
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    406: "NOT_ACCEPTABLE",
    413: "PAYLOAD_TOO_LARGE",
    429: "RATE_LIMITED",
}


PUBLIC_API_PREFIX = "/api/public/"


def error_body(code: str, message: str, details: str | None = None) -> dict[str, Any]:
    """The one place the public error envelope is built."""
    return {"ok": False, "error": {"code": code, "details": details or message, "message": message}}


def envelope_for(path: str, code: str, message: str, details: str | None = None) -> dict[str, Any]:
    """The right error envelope for whichever API the request was aimed at.

    Middleware runs before the mount, so a 429 or a 413 on a public path must
    still speak the public dialect — a client parsing `ok` should never meet
    the app API's shape.
    """
    if path.startswith(PUBLIC_API_PREFIX):
        return error_body(code, message, details)
    return {"error": {"code": code.lower(), "message": message}}


def _details_from(exc: NodumError) -> str | None:
    """A NodumError's structured extras, flattened into one readable line."""
    if not exc.details:
        return None
    return "; ".join(f"{k}={v}" for k, v in exc.details.items())


def _details_from_validation(exc: RequestValidationError) -> str:
    """`body.title: Field required; query.limit: Input should be <= 200`."""
    parts: list[str] = []
    for err in exc.errors():
        where = ".".join(str(p) for p in err.get("loc", ()) if p != "body" or len(err.get("loc", ())) == 1)
        parts.append(f"{where}: {err.get('msg', 'invalid')}" if where else str(err.get("msg", "invalid")))
    return "; ".join(parts) or "Request validation failed."


def register_public_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(NodumError)
    async def _nodum_error(request: Request, exc: NodumError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code.upper(), exc.message, _details_from(exc)),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_body("VALIDATION_FAILED", "Request validation failed.", _details_from_validation(exc)),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, f"HTTP_{exc.status_code}")
        return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail)))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("public_api_unhandled", path=request.url.path)
        return JSONResponse(status_code=500, content=error_body("INTERNAL_ERROR", "Internal server error."))
