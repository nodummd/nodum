"""Authentication service — signup, login, refresh rotation, logout."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import Session, User
from app.services.service_response import ServiceResponse
from app.settings import get_settings
from app.utils.jwt_utils import create_access_token, create_refresh_token, decode_token, new_jti
from app.utils.password_utils import hash_password, verify_password

logger = get_logger("auth")


class TokenBundle:
    """Access + refresh tokens with the owning user (service-layer DTO)."""

    def __init__(self, access_token: str, refresh_token: str, user: User) -> None:
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.user = user


async def signup(db: AsyncSession, *, email: str, password: str, name: str) -> ServiceResponse[User]:
    """Create a new user account."""
    email = email.strip().lower()
    existing = await db.scalar(select(User.id).where(User.email == email))
    if existing:
        return ServiceResponse.fail("already_exists", "An account with this email already exists.")

    user = User(email=email, password_hash=hash_password(password), name=name.strip())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("user_signed_up", user_id=str(user.id))
    return ServiceResponse.ok(user)


async def login(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> ServiceResponse[TokenBundle]:
    """Verify credentials and mint a token pair backed by a session row."""
    email = email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        # Same error for unknown email and wrong password — no account probing.
        return ServiceResponse.fail("unauthorized", "Invalid email or password.")
    if not user.is_active:
        return ServiceResponse.fail("forbidden", "This account is disabled.")

    settings = get_settings()
    jti = new_jti()
    session = Session(
        user_id=user.id,
        refresh_token_jti=jti,
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
    )
    user.last_login_at = datetime.now(UTC)
    db.add(session)
    await db.commit()

    return ServiceResponse.ok(
        TokenBundle(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id, jti),
            user=user,
        )
    )


async def refresh(db: AsyncSession, *, refresh_token: str) -> ServiceResponse[TokenBundle]:
    """Rotate the refresh token: old JTI is spent, a new pair is issued.

    Reuse of a spent JTI invalidates the whole session (stolen-token defense).
    """
    payload = decode_token(refresh_token, expected_type="refresh")
    if payload is None:
        return ServiceResponse.fail("unauthorized", "Invalid or expired refresh token.")

    jti = str(payload.get("jti", ""))
    user_id = UUID(str(payload["sub"]))

    session = await db.scalar(select(Session).where(Session.refresh_token_jti == jti))
    if session is None:
        # JTI not found: either forged, or already rotated (token reuse).
        # Invalidate every active session for this user as a precaution.
        result = await db.execute(select(Session).where(Session.user_id == user_id, Session.is_active.is_(True)))
        for s in result.scalars():
            s.invalidate("refresh_token_reuse")
        await db.commit()
        logger.warning("refresh_token_reuse_detected", user_id=str(user_id))
        return ServiceResponse.fail("unauthorized", "Invalid refresh token.")

    if not session.is_valid:
        return ServiceResponse.fail("unauthorized", "Session is no longer valid.")

    user = await db.get(User, session.user_id)
    if user is None or not user.is_active:
        return ServiceResponse.fail("unauthorized", "Account is not available.")

    settings = get_settings()
    new_refresh_jti = new_jti()
    session.refresh_token_jti = new_refresh_jti
    session.expires_at = datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    await db.commit()

    return ServiceResponse.ok(
        TokenBundle(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id, new_refresh_jti),
            user=user,
        )
    )


async def logout(db: AsyncSession, *, refresh_token: str | None) -> ServiceResponse[None]:
    """Invalidate the session matching the presented refresh token."""
    if refresh_token:
        payload = decode_token(refresh_token, expected_type="refresh")
        if payload:
            session = await db.scalar(select(Session).where(Session.refresh_token_jti == str(payload.get("jti", ""))))
            if session and session.is_active:
                session.invalidate("user_logout")
                await db.commit()
    # Logout always succeeds from the client's perspective.
    return ServiceResponse.ok(None)


async def get_user(db: AsyncSession, user_id: UUID) -> ServiceResponse[User]:
    """Fetch the current user profile."""
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return ServiceResponse.fail("unauthorized", "Account is not available.")
    return ServiceResponse.ok(user)


async def update_profile(
    db: AsyncSession,
    user_id: UUID,
    *,
    name: str | None = None,
    avatar_url: str | None = None,
    settings_patch: dict | None = None,
) -> ServiceResponse[User]:
    """Update profile fields; settings are shallow-merged."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("unauthorized", "Account is not available.")
    if name is not None:
        user.name = name.strip()
    if avatar_url is not None:
        user.avatar_url = avatar_url
    if settings_patch is not None:
        user.settings = {**user.settings, **settings_patch}
    await db.commit()
    await db.refresh(user)
    return ServiceResponse.ok(user)


async def change_password(
    db: AsyncSession, user_id: UUID, *, current_password: str, new_password: str
) -> ServiceResponse[None]:
    """Change password and invalidate all other sessions."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("unauthorized", "Account is not available.")
    if not verify_password(current_password, user.password_hash):
        return ServiceResponse.fail("unauthorized", "Current password is incorrect.")

    user.password_hash = hash_password(new_password)
    result = await db.execute(select(Session).where(Session.user_id == user_id, Session.is_active.is_(True)))
    for s in result.scalars():
        s.invalidate("password_changed")
    await db.commit()
    return ServiceResponse.ok(None)
