"""Auth endpoints — signup, login, refresh, logout, profile."""

from typing import Any

from fastapi import APIRouter, Request, Response, status

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenPairOut,
    UpdateProfileRequest,
    UserOut,
)
from app.services import auth_service
from app.settings import get_settings
from app.utils.cookie_utils import clear_refresh_cookie, read_refresh_cookie, set_refresh_cookie

router = APIRouter()


def _token_payload(bundle: auth_service.TokenBundle) -> TokenPairOut:
    settings = get_settings()
    return TokenPairOut(
        access_token=bundle.access_token,
        refresh_token=bundle.refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(bundle.user),
    )


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, request: Request, response: Response, db: SessionDep) -> dict[str, Any]:
    """Create an account with its onboarding vault (atomic), then log straight in."""
    (await auth_service.signup(db, email=body.email, password=body.password, name=body.name)).unwrap()
    bundle = (
        await auth_service.login(
            db,
            email=body.email,
            password=body.password,
            user_agent=request.headers.get("User-Agent"),
            ip_address=request.client.host if request.client else None,
        )
    ).unwrap()
    set_refresh_cookie(response, bundle.refresh_token)
    return {"data": _token_payload(bundle).model_dump()}


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response, db: SessionDep) -> dict[str, Any]:
    """Exchange credentials for an access + refresh token pair."""
    bundle = (
        await auth_service.login(
            db,
            email=body.email,
            password=body.password,
            user_agent=request.headers.get("User-Agent"),
            ip_address=request.client.host if request.client else None,
        )
    ).unwrap()
    set_refresh_cookie(response, bundle.refresh_token)
    return {"data": _token_payload(bundle).model_dump()}


@router.post("/refresh")
async def refresh(
    request: Request, response: Response, db: SessionDep, body: RefreshRequest | None = None
) -> dict[str, Any]:
    """Rotate the refresh token (cookie preferred, body fallback)."""
    token = read_refresh_cookie(request) or (body.refresh_token if body else None)
    if not token:
        from app.core.custom_exceptions import UnauthorizedError

        raise UnauthorizedError("No refresh token provided.")
    bundle = (await auth_service.refresh(db, refresh_token=token)).unwrap()
    set_refresh_cookie(response, bundle.refresh_token)
    return {"data": _token_payload(bundle).model_dump()}


@router.post("/logout")
async def logout(
    request: Request, response: Response, db: SessionDep, body: RefreshRequest | None = None
) -> dict[str, Any]:
    """Invalidate the current session and clear the cookie."""
    token = read_refresh_cookie(request) or (body.refresh_token if body else None)
    (await auth_service.logout(db, refresh_token=token)).unwrap()
    clear_refresh_cookie(response)
    return {"data": {"message": "Logged out."}}


@router.get("/me")
async def me(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Current user profile."""
    user = (await auth_service.get_user(db, user_id)).unwrap()
    return {"data": UserOut.model_validate(user).model_dump()}


@router.patch("/me")
async def update_me(body: UpdateProfileRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Update profile fields; settings are shallow-merged."""
    user = (
        await auth_service.update_profile(
            db, user_id, name=body.name, avatar_url=body.avatar_url, settings_patch=body.settings
        )
    ).unwrap()
    return {"data": UserOut.model_validate(user).model_dump()}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Change password; all sessions are invalidated."""
    (
        await auth_service.change_password(
            db, user_id, current_password=body.current_password, new_password=body.new_password
        )
    ).unwrap()
    return {"data": {"message": "Password changed. Please log in again."}}
