"""Authentication service — signup, login, refresh rotation, logout."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import Session, User
from app.services import api_token_service
from app.services.service_response import ServiceResponse
from app.settings import get_settings
from app.utils.jwt_utils import create_access_token, create_refresh_token, decode_token, new_jti
from app.utils.password_utils import hash_password_async, verify_password_async

logger = get_logger("auth")


class TokenBundle:
    """Access + refresh tokens with the owning user (service-layer DTO)."""

    def __init__(self, access_token: str, refresh_token: str, user: User) -> None:
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.user = user


async def signup(db: AsyncSession, *, email: str, password: str, name: str) -> ServiceResponse[User]:
    """Create a new user account WITH its onboarding vault — one transaction."""
    email = email.strip().lower()
    existing = await db.scalar(select(User.id).where(User.email == email))
    if existing:
        return ServiceResponse.fail("already_exists", "An account with this email already exists.")

    user = User(email=email, password_hash=await hash_password_async(password), name=name.strip())
    db.add(user)
    await db.flush()

    from app.services.vault_service import create_default_vault

    await create_default_vault(db, user.id)
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
    if user is None or not await verify_password_async(password, user.password_hash):
        # Same error for unknown email and wrong password — no account probing.
        return ServiceResponse.fail("unauthorized", "Invalid email or password.")
    if not user.is_active:
        return ServiceResponse.fail("forbidden", "This account is disabled.")

    # Checked only after the password, so this never reveals whether an
    # address has an account.
    from app.services.email_verification_service import verification_required

    if verification_required() and not user.email_verified:
        return ServiceResponse.fail(
            "email_not_verified", "Confirm your email address to finish setting up your account."
        )

    return ServiceResponse.ok(await mint_session(db, user, user_agent=user_agent, ip_address=ip_address))


async def mint_session(
    db: AsyncSession, user: User, *, user_agent: str | None = None, ip_address: str | None = None
) -> TokenBundle:
    """Create a session row and token pair for an already-authenticated user
    (password login and OAuth callbacks share this)."""
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
    await db.refresh(session)

    return TokenBundle(
        access_token=create_access_token(user.id, session.id),
        refresh_token=create_refresh_token(user.id, jti),
        user=user,
    )


# Rotated JTIs stay valid for this window so parallel tabs / racing page
# loads that present the just-spent token are treated as benign duplicates
# instead of tripping the stolen-token defense.
REFRESH_GRACE_SECONDS = 30
_GRACE_KEY = "refresh_grace:{jti}"


async def refresh(db: AsyncSession, *, refresh_token: str) -> ServiceResponse[TokenBundle]:
    """Rotate the refresh token: old JTI is spent, a new pair is issued.

    Reuse of a spent JTI outside the grace window invalidates the whole
    session family (stolen-token defense).
    """
    from app.core.redis import redis_control

    payload = decode_token(refresh_token, expected_type="refresh")
    if payload is None:
        return ServiceResponse.fail("unauthorized", "Invalid or expired refresh token.")

    jti = str(payload.get("jti", ""))
    user_id = UUID(str(payload["sub"]))

    # FOR UPDATE serializes concurrent rotations of the same session across
    # workers — without it, two racing refreshes both rotate and the loser's
    # JTI lands nowhere, tripping the reuse defense later.
    session = await db.scalar(select(Session).where(Session.refresh_token_jti == jti).with_for_update())
    graced = False
    if session is None:
        # Recently-rotated JTI? Benign duplicate (second tab, racing reload).
        graced_session_id: str | None = None
        try:
            graced_session_id = await redis_control.get(_GRACE_KEY.format(jti=jti))
        except Exception:
            logger.warning("refresh_grace_redis_unavailable")
        if graced_session_id:
            session = await db.scalar(select(Session).where(Session.id == UUID(graced_session_id)).with_for_update())
            graced = session is not None

    if session is None:
        # JTI unknown and not in grace: forged or genuinely stolen-and-reused.
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

    if graced:
        # CONVERGE, do not rotate again: every racer ends up holding the
        # session's current JTI, so response ordering can never leave the
        # browser with a token that dies when the grace window closes.
        await db.commit()  # release the row lock
        return ServiceResponse.ok(
            TokenBundle(
                access_token=create_access_token(user.id, session.id),
                refresh_token=create_refresh_token(user.id, session.refresh_token_jti),
                user=user,
            )
        )

    old_jti = session.refresh_token_jti
    new_refresh_jti = new_jti()
    session.refresh_token_jti = new_refresh_jti
    session.expires_at = datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)

    # BEFORE the commit, not after. A racing refresh that reads the row once the
    # new JTI is visible finds the old JTI in neither the table nor the grace
    # key, concludes the token was stolen, and invalidates every session for the
    # user — logging them out for doing two things at once. Publishing the grace
    # key first means the old JTI is always resolvable somewhere.
    #
    # Writing it early is safe: if the commit below fails, the key merely points
    # at a session whose JTI never changed, and the grace path converges on
    # whatever JTI that session currently holds.
    try:
        await redis_control.set(_GRACE_KEY.format(jti=old_jti), str(session.id), ex=REFRESH_GRACE_SECONDS)
    except Exception:
        logger.warning("refresh_grace_redis_unavailable")

    await db.commit()

    return ServiceResponse.ok(
        TokenBundle(
            access_token=create_access_token(user.id, session.id),
            refresh_token=create_refresh_token(user.id, new_refresh_jti),
            user=user,
        )
    )


async def revoke_existing_sessions(db: AsyncSession, user_id: UUID, reason: str) -> None:
    """Kill every session this user currently holds. The caller commits.

    Deliberately per-session (``revoked_sid:``) rather than the user-wide
    ``auth_revoked_user:`` marker used by change_password: that marker is
    compared with ``iat <= revoked_at``, so a session minted in the same second
    as the revocation would be killed too. Callers that revoke and then
    immediately issue a new session — OAuth account linking — need the new one
    to survive, and a fresh session id is never in this set.
    """
    result = await db.execute(select(Session).where(Session.user_id == user_id, Session.is_active.is_(True)))
    sessions = list(result.scalars())
    for session in sessions:
        session.invalidate(reason)

    try:
        from app.core.redis import redis_control

        settings = get_settings()
        ttl = (settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES + 1) * 60
        for session in sessions:
            await redis_control.set(f"revoked_sid:{session.id}", "1", ex=ttl)
    except Exception:
        logger.warning("revocation_marker_failed")


async def logout(db: AsyncSession, *, refresh_token: str | None) -> ServiceResponse[None]:
    """Invalidate the session and instantly revoke its outstanding access tokens."""
    if refresh_token:
        payload = decode_token(refresh_token, expected_type="refresh")
        if payload:
            session = await db.scalar(select(Session).where(Session.refresh_token_jti == str(payload.get("jti", ""))))
            if session and session.is_active:
                session.invalidate("user_logout")
                await db.commit()
                try:
                    from app.core.redis import redis_control

                    settings = get_settings()
                    await redis_control.set(
                        f"revoked_sid:{session.id}",
                        "1",
                        ex=(settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES + 1) * 60,
                    )
                except Exception:
                    logger.warning("revocation_marker_failed")
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
    """Update profile fields; settings are shallow-merged.

    The merge is read-modify-write, so the row is locked for it: two PATCHes in
    flight at once (the first-run tour finishing and the demo answered in the
    same click) each read the settings before the other wrote, and the last
    commit silently dropped the other's key.
    """
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
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
    if not await verify_password_async(current_password, user.password_hash):
        return ServiceResponse.fail("unauthorized", "Current password is incorrect.")

    user.password_hash = await hash_password_async(new_password)
    result = await db.execute(select(Session).where(Session.user_id == user_id, Session.is_active.is_(True)))
    for s in result.scalars():
        s.invalidate("password_changed")
    # MCP tokens are passwords for one program each — a password change is
    # the moment to cut them, exactly like the other sessions.
    await api_token_service.revoke_all(db, user_id, reason="password_changed")
    await db.commit()
    try:
        from app.core.redis import redis_control

        settings = get_settings()
        await redis_control.set(
            f"auth_revoked_user:{user_id}",
            str(int(datetime.now(UTC).timestamp())),
            ex=(settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES + 1) * 60,
        )
    except Exception:
        logger.warning("revocation_marker_failed")
    return ServiceResponse.ok(None)
