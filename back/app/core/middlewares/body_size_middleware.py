"""Reject oversized request bodies before anything reads them.

FastAPI parses the multipart body while resolving the request, which happens
*before* the auth dependency runs — so an unauthenticated caller can make the
process spool gigabytes to the container's disk and then into RAM, and every
handler-level size check fires too late to stop it.

Content-Length is advisory (a chunked request omits it), so this is a cheap
first line rather than the whole defence: the handlers still check
UploadFile.size, and a reverse proxy in front should carry its own body cap.
What this closes is the pre-auth case, which nothing else covers.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.constants.limits import MAX_REQUEST_BODY_BYTES
from app.core.logging import get_logger

logger = get_logger("body_size")


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """413 anything declaring a body larger than MAX_REQUEST_BODY_BYTES."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        declared = request.headers.get("content-length")
        if declared:
            try:
                length = int(declared)
            except ValueError:
                # A malformed Content-Length is not something to forward on.
                from app.api.public.errors import envelope_for

                return JSONResponse(
                    status_code=400,
                    content=envelope_for(request.url.path, "BAD_REQUEST", "Invalid Content-Length."),
                )
            if length > MAX_REQUEST_BODY_BYTES:
                logger.warning("request_body_too_large", declared=length, path=request.url.path)
                from app.api.public.errors import envelope_for

                return JSONResponse(
                    status_code=413,
                    content=envelope_for(
                        request.url.path,
                        "PAYLOAD_TOO_LARGE",
                        "Request body is too large.",
                        f"{length} bytes declared; the limit is {MAX_REQUEST_BODY_BYTES}",
                    ),
                )
        return await call_next(request)
