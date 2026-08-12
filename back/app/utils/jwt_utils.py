"""JWT creation and validation."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from jose import JWTError, jwt

from app.settings import get_settings

# Only signed, supported algorithms — guards against alg-downgrade attacks.
_ALLOWED_JWT_ALGORITHMS = {"HS256", "HS384", "HS512", "RS256", "RS384", "RS512"}


def new_jti() -> str:
    """Random token identifier."""
    return secrets.token_hex(16)


def _create_token(sub: UUID, jti: str, token_type: str, expires_delta: timedelta) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(sub),
        "jti": jti,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: UUID) -> str:
    """Short-lived stateless access token."""
    settings = get_settings()
    return _create_token(user_id, new_jti(), "access", timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(user_id: UUID, jti: str) -> str:
    """Long-lived refresh token whose JTI is tracked in the sessions table."""
    settings = get_settings()
    return _create_token(user_id, jti, "refresh", timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS))


def decode_token(token: str, expected_type: str) -> dict[str, Any] | None:
    """Decode and validate a JWT. Returns the payload, or None if invalid."""
    settings = get_settings()
    if settings.JWT_ALGORITHM not in _ALLOWED_JWT_ALGORITHMS:
        return None
    try:
        payload = dict(jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]))
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload
