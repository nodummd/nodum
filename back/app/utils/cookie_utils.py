"""Refresh-token cookie helpers."""

from fastapi import Request, Response

from app.settings import get_settings

REFRESH_COOKIE_NAME = "nodum_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Attach the refresh token as an httpOnly cookie scoped to auth routes."""
    settings = get_settings()
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.ENVIRONMENT in ("production", "staging"),
        samesite="lax",
    )


def clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh cookie on logout."""
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


def read_refresh_cookie(request: Request) -> str | None:
    """Read the refresh token cookie if present."""
    return request.cookies.get(REFRESH_COOKIE_NAME)
