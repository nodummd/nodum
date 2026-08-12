"""Authentication dependencies — Bearer token extraction and validation."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request

from app.core.custom_exceptions import UnauthorizedError
from app.utils.jwt_utils import decode_token


async def get_current_user_id(request: Request) -> UUID:
    """Validate the Authorization Bearer access token and return the user id."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise UnauthorizedError("Not authenticated.")

    payload = decode_token(auth_header.removeprefix("Bearer ").strip(), expected_type="access")
    if payload is None:
        raise UnauthorizedError("Invalid or expired token.")

    try:
        return UUID(str(payload.get("sub")))
    except (ValueError, TypeError) as e:
        raise UnauthorizedError("Invalid token subject.") from e


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]
