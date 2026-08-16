"""Google OAuth — env-gated sign-in (hourly's oauth_connection pattern).

The Google HTTP calls live in two module functions so tests monkeypatch them
without any network mocking. State tokens ride in the control-plane Redis
with a 10-minute TTL.
"""

import secrets

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import OAuthConnection, User
from app.services.service_response import ServiceResponse
from app.settings import get_settings

logger = get_logger("oauth")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

_STATE_KEY = "oauth_state:{state}"
_STATE_TTL = 600


def google_enabled() -> bool:
    s = get_settings()
    return bool(s.GOOGLE_CLIENT_ID and s.GOOGLE_CLIENT_SECRET)


def _redirect_uri() -> str:
    return f"{get_settings().OAUTH_REDIRECT_BASE_URL.rstrip('/')}/api/v1/auth/google/callback"


async def build_start_url() -> str:
    """Store a CSRF state and return the Google consent URL."""
    from app.core.redis import redis_control

    state = secrets.token_urlsafe(32)
    await redis_control.set(_STATE_KEY.format(state=state), "1", ex=_STATE_TTL)
    params = httpx.QueryParams(
        client_id=get_settings().GOOGLE_CLIENT_ID,
        redirect_uri=_redirect_uri(),
        response_type="code",
        scope="openid email profile",
        state=state,
        prompt="select_account",
    )
    return f"{GOOGLE_AUTH_URL}?{params}"


async def _exchange_code(code: str) -> str:
    """Authorization code → access token. Monkeypatched in tests."""
    s = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": s.GOOGLE_CLIENT_ID,
                "client_secret": s.GOOGLE_CLIENT_SECRET,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return str(resp.json()["access_token"])


async def _fetch_userinfo(access_token: str) -> dict:
    """Access token → {sub, email, name}. Monkeypatched in tests."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        resp.raise_for_status()
        return dict(resp.json())


async def handle_google_callback(
    db: AsyncSession, *, code: str, state: str, user_agent: str | None = None
) -> ServiceResponse:
    """Verify state, resolve the Google identity, and mint a session.

    Resolution order: existing connection → existing user by email (link) →
    brand-new user (random password, welcome vault via the signup path).
    """
    from app.core.redis import redis_control
    from app.services import auth_service

    key = _STATE_KEY.format(state=state)
    if not state or not await redis_control.get(key):
        return ServiceResponse.fail("validation_failed", "Invalid or expired OAuth state.")
    await redis_control.delete(key)

    try:
        access_token = await _exchange_code(code)
        info = await _fetch_userinfo(access_token)
    except Exception as e:
        logger.warning("google_oauth_exchange_failed", error=str(e))
        return ServiceResponse.fail("unauthorized", "Google sign-in failed.")

    sub = str(info.get("sub") or "")
    email = str(info.get("email") or "").strip().lower()
    name = str(info.get("name") or email.split("@")[0] or "Nodum user")
    if not sub or not email:
        return ServiceResponse.fail("unauthorized", "Google profile is missing id or email.")

    # Google returns email_verified alongside email, and an *unverified*
    # address proves nothing about who is driving the flow. Without this check
    # the branch below signs the caller into whatever local account happens to
    # carry that address — account takeover with no password.
    # Accept the string form too: some providers serialise it as "true".
    verified = info.get("email_verified")
    if verified is not True and str(verified).lower() != "true":
        logger.warning("google_oauth_unverified_email", email=email)
        return ServiceResponse.fail("unauthorized", "Google has not verified this email address.")

    connection = await db.scalar(
        select(OAuthConnection).where(OAuthConnection.provider == "google", OAuthConnection.provider_account_id == sub)
    )
    if connection is not None:
        user = await db.scalar(select(User).where(User.id == connection.user_id))
    else:
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            created = await auth_service.signup(db, email=email, password=secrets.token_urlsafe(48), name=name)
            if not created.success:
                return created
            user = created.data
        else:
            # First time this Google identity attaches to an account that
            # already existed locally. If somebody registered the address
            # before its real owner showed up, this is where their foothold
            # ends: every session they hold dies before we mint the new one.
            await auth_service.revoke_existing_sessions(db, user.id, "oauth_account_linked")

        # Google vouched for the address (checked above), so the column stops
        # being decorative and becomes a usable trust signal.
        user.email_verified = True
        db.add(OAuthConnection(user_id=user.id, provider="google", provider_account_id=sub, email=email))
        await db.commit()

    if user is None or not user.is_active:
        return ServiceResponse.fail("forbidden", "This account is disabled.")

    bundle = await auth_service.mint_session(db, user, user_agent=user_agent)
    return ServiceResponse.ok(bundle)
