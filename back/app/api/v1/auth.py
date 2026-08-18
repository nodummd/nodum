"""Auth endpoints — signup, login, refresh, logout, profile, Google OAuth."""

from typing import Any

from fastapi import APIRouter, Request, Response, status

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    ResendVerificationRequest,
    SignupRequest,
    TokenPairOut,
    UpdateProfileRequest,
    UserOut,
    VerificationRequiredOut,
    VerifyEmailRequest,
)
from app.services import auth_service, email_verification_service
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
    """Create an account with its onboarding vault (atomic).

    Logs straight in unless the deployment requires email verification, in
    which case a code goes out and no tokens are issued until it comes back.
    """
    user = (await auth_service.signup(db, email=body.email, password=body.password, name=body.name)).unwrap()

    if email_verification_service.verification_required():
        (await email_verification_service.issue_code(db, user, force=True)).unwrap()
        await db.commit()
        settings = get_settings()
        return {
            "data": VerificationRequiredOut(
                email=user.email, expires_in_minutes=settings.EMAIL_OTP_TTL_MINUTES
            ).model_dump()
        }

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


@router.post("/verify-email")
async def verify_email(
    body: VerifyEmailRequest, request: Request, response: Response, db: SessionDep
) -> dict[str, Any]:
    """Confirm an address with its one-time code and log the account in."""
    user = (await email_verification_service.verify(db, email=body.email, code=body.code)).unwrap()
    bundle = await auth_service.mint_session(
        db,
        user,
        user_agent=request.headers.get("User-Agent"),
        ip_address=request.client.host if request.client else None,
    )
    set_refresh_cookie(response, bundle.refresh_token)
    return {"data": _token_payload(bundle).model_dump()}


@router.post("/resend-verification")
async def resend_verification(body: ResendVerificationRequest, db: SessionDep) -> dict[str, Any]:
    """Send a fresh code.

    Answers the same way whether or not the address has an unverified account:
    this endpoint is unauthenticated, so a truthful "no such user" would turn it
    into an account-existence oracle. A real cooldown breach still reports back,
    since the caller already knows they just asked.
    """
    from sqlalchemy import select

    from app.models.auth import User as UserModel

    sent = {"data": {"message": "If that address needs confirming, a new code is on its way."}}
    user = await db.scalar(select(UserModel).where(UserModel.email == body.email.strip().lower()))
    if user is None or user.email_verified or not user.is_active:
        return sent

    (await email_verification_service.issue_code(db, user)).unwrap()
    await db.commit()
    return sent


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


# ── Google OAuth ─────────────────────────────────────────────────────────────


@router.get("/providers")
async def auth_providers() -> dict[str, Any]:
    """Which external sign-in providers are configured (drives UI buttons)."""
    from app.services import oauth_service

    return {"data": {"google": oauth_service.google_enabled()}}


@router.get("/google/start")
async def google_start() -> Any:
    from fastapi.responses import RedirectResponse

    from app.core.custom_exceptions import NotFoundError
    from app.services import oauth_service

    if not oauth_service.google_enabled():
        raise NotFoundError("Google sign-in is not enabled.")
    return RedirectResponse(await oauth_service.build_start_url(), status_code=307)


@router.get("/google/callback")
async def google_callback(request: Request, db: SessionDep, code: str = "", state: str = "") -> Any:
    from fastapi.responses import RedirectResponse

    from app.services import oauth_service
    from app.settings import get_settings

    base = get_settings().OAUTH_REDIRECT_BASE_URL.rstrip("/")
    result = await oauth_service.handle_google_callback(
        db, code=code, state=state, user_agent=request.headers.get("User-Agent")
    )
    if not result.success:
        return RedirectResponse(f"{base}/login?error=oauth", status_code=307)
    response = RedirectResponse(f"{base}/", status_code=307)
    set_refresh_cookie(response, result.data.refresh_token)
    return response
