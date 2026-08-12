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

    # Instant-revocation markers (logout / password change). Fail-open when
    # Redis is unavailable — token expiry (15min) remains the backstop.
    try:
        from app.core.redis import redis_client

        sid = payload.get("sid")
        if sid and await redis_client.get(f"revoked_sid:{sid}"):
            raise UnauthorizedError("Token has been revoked.")
        revoked_at = await redis_client.get(f"auth_revoked_user:{payload.get('sub')}")
        # <= : tokens minted in the same second as the revocation die too
        if revoked_at and int(payload.get("iat", 0)) <= int(revoked_at):
            raise UnauthorizedError("Token has been revoked.")
    except UnauthorizedError:
        raise
    except Exception:
        pass

    try:
        return UUID(str(payload.get("sub")))
    except (ValueError, TypeError) as e:
        raise UnauthorizedError("Invalid token subject.") from e


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]
