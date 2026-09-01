"""Google OAuth for *data sources* — separate from sign-in, on purpose.

`oauth_service` authenticates a person. This authorises us to read their data,
which is a different consent, a different scope tier and a different OAuth
client. Sharing one client would drag the login flow into Gmail's restricted-
scope compliance regime the first time anyone connected a mailbox, so the two
stay apart and `oauth_service` is left untouched.

## The 7-day trap

A Google Cloud project whose consent screen is left in **Testing** issues
refresh tokens that expire after exactly seven days. Not access tokens —
refresh tokens. Every self-hoster who follows a Google quickstart lands there,
connects an account, and finds sync dead the following week with an opaque
`invalid_grant`. Two defences here: `exchange_code` refuses to create a
connection at all when the token response carries no refresh token, and
`classify_refresh_failure` recognises the week-old-grant signature and returns
the one message that actually fixes it.
"""

from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.core.logging import get_logger
from app.settings import get_settings

from .base import ProviderError

logger = get_logger("google_sync")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"

_STATE_KEY = "gsync_state:{state}"
_STATE_TTL = 900

#: Identity scopes are always requested: we need a stable account id to key the
#: connection on, and the address to show in the UI.
BASE_SCOPES = ("openid", "email")

#: Scopes on Google's *restricted* list. A hosted, multi-user deployment that
#: requests any of these owes an annual CASA assessment by an authorised lab.
#: `test_provider_scopes` fails CI if an adapter reaches for one without being
#: gated, so this is enforcement rather than documentation.
RESTRICTED_SCOPES = frozenset(
    {
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.metadata",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/drive.readonly",
    }
)


async def _post(url: str, data: dict[str, str]) -> httpx.Response:
    """POST to Google, turning transport failures into ProviderError.

    Every call here sits on the OAuth callback, which is a top-level browser
    redirect. An unhandled httpx error there is not a logged blip — it is a
    raw 500 page shown to the user mid-flow, with the authorisation code
    already spent and no way back except starting over.
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            return await client.post(url, data=data)
    except httpx.HTTPError as exc:
        raise ProviderError(
            "Could not reach Google. This is usually temporary — try again in a moment.",
            error_class="provider_5xx",
            reason="google_unreachable",
        ) from exc


def sync_enabled() -> bool:
    s = get_settings()
    return bool(s.GOOGLE_SYNC_CLIENT_ID and s.GOOGLE_SYNC_CLIENT_SECRET)


def redirect_uri() -> str:
    return f"{get_settings().OAUTH_REDIRECT_BASE_URL.rstrip('/')}/api/v1/connections/google/callback"


async def build_start_url(
    *,
    user_id: str,
    vault_id: str,
    provider: str,
    scopes: list[str],
    settings: dict[str, Any] | None = None,
) -> str:
    """Store the CSRF state and return the consent URL.

    The state carries everything the callback needs to finish the job: the
    user, the vault, **which provider was asked for**, and the options chosen
    before connecting.

    The provider is the load-bearing one. `include_granted_scopes=true` means
    a Gmail consent comes back carrying every previously-granted Calendar
    scope too, and inferring the provider from the grant then matches Calendar
    first — so "Connect Gmail" silently re-stamped the user's existing
    Calendar connection and never created a Gmail one. The callback cannot be
    told through the redirect (Google controls that URL), so the state token
    is the only honest channel.

    Settings ride along for the same reason: they are chosen *before* the
    redirect, and parking them client-side loses them if the consent screen is
    finished in another tab.
    """
    from app.core.redis import redis_control

    state = secrets.token_urlsafe(32)
    payload = json.dumps({"u": user_id, "v": vault_id, "p": provider, "s": settings or {}})
    await redis_control.set(_STATE_KEY.format(state=state), payload, ex=_STATE_TTL)
    params = httpx.QueryParams(
        client_id=get_settings().GOOGLE_SYNC_CLIENT_ID,
        redirect_uri=redirect_uri(),
        response_type="code",
        scope=" ".join([*BASE_SCOPES, *scopes]),
        state=state,
        # Without access_type=offline there is no refresh token at all, and
        # without prompt=consent Google withholds it on every re-consent —
        # which looks like an intermittent bug rather than a missing parameter.
        access_type="offline",
        prompt="consent",
        # Incremental authorisation: adding Gmail later must not silently drop
        # a Calendar grant the user already made.
        include_granted_scopes="true",
    )
    return f"{AUTH_URL}?{params}"


async def consume_state(state: str) -> tuple[str, str, str, dict[str, Any]] | None:
    """Validate and burn the CSRF state.

    Returns (user_id, vault_id, provider, initial_settings), or None for
    anything we did not mint or cannot read whole — a half-read state must
    refuse rather than resolve to "somewhere".
    """
    from app.core.redis import redis_control

    key = _STATE_KEY.format(state=state)
    raw = await redis_control.get(key)
    if raw is None:
        return None
    await redis_control.delete(key)
    value = raw.decode() if isinstance(raw, bytes) else str(raw)
    try:
        payload = json.loads(value)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    user_id = str(payload.get("u") or "")
    vault_id = str(payload.get("v") or "")
    provider = str(payload.get("p") or "")
    settings = payload.get("s")
    if not user_id or not vault_id:
        return None
    return (user_id, vault_id, provider, settings if isinstance(settings, dict) else {})


async def exchange_code(code: str) -> dict[str, Any]:
    """Authorization code → tokens. Raises if there is no refresh token.

    Refusing the connection here rather than storing a half-working one is the
    difference between an error the user can act on immediately and a feature
    that appears to work for a week and then dies.
    """
    s = get_settings()
    resp = await _post(
        TOKEN_URL,
        {
            "code": code,
            "client_id": s.GOOGLE_SYNC_CLIENT_ID,
            "client_secret": s.GOOGLE_SYNC_CLIENT_SECRET,
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
        },
    )
    if resp.status_code >= 400:
        # The upstream body is logged, not shown. It is raw third-party output
        # with no value to the person reading it, and it ends up rendered in
        # the connections list.
        logger.warning("google_code_exchange_failed", status=resp.status_code, body=resp.text[:300])
        raise ProviderError(
            "Google rejected the authorisation. Please try connecting again.",
            error_class="auth",
            reason="code_rejected",
        )
    payload = dict(resp.json())
    if not payload.get("refresh_token"):
        raise ProviderError(
            "Google did not return a refresh token, so this connection could not sync in the "
            "background. Remove Nodum from your Google account permissions and connect again.",
            error_class="auth",
            reason="no_refresh_token",
        )
    return payload


async def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    """Refresh token → a new access token."""
    s = get_settings()
    resp = await _post(
        TOKEN_URL,
        {
            "refresh_token": refresh_token,
            "client_id": s.GOOGLE_SYNC_CLIENT_ID,
            "client_secret": s.GOOGLE_SYNC_CLIENT_SECRET,
            "grant_type": "refresh_token",
        },
    )
    if resp.status_code == 400:
        # `classify_refresh_failure` reads this to tell invalid_grant apart, so
        # the raw body is carried but never reaches the UI — the classifier
        # replaces it with a message that says what to actually do.
        raise ProviderError(resp.text[:300], error_class="auth")
    if resp.status_code >= 500:
        raise ProviderError(f"Google token endpoint returned {resp.status_code}", error_class="provider_5xx")
    if resp.status_code >= 400:
        raise ProviderError(f"Token refresh failed: {resp.text[:200]}", error_class="auth")
    return dict(resp.json())


def classify_refresh_failure(message: str, *, connected_at: datetime | None) -> tuple[str, str]:
    """Turn a refresh failure into (error_class, user-facing message).

    The Testing-mode case is singled out because the generic advice —
    "reconnect your account" — does not fix it. The user reconnects, it works
    for seven days, and it breaks again, forever. Recognising a grant that died
    within eight days of being made lets us say the one thing that helps.
    """
    lowered = message.lower()
    if "invalid_grant" in lowered:
        age = None
        if connected_at is not None:
            reference = connected_at if connected_at.tzinfo else connected_at.replace(tzinfo=UTC)
            age = datetime.now(UTC) - reference
        if age is not None and age < timedelta(days=8):
            return (
                "oauth_testing_mode",
                "Google expired this connection after 7 days, which it does for OAuth consent "
                "screens still set to “Testing”. In your Google Cloud project open "
                "APIs & Services → OAuth consent screen, press “Publish app” to move it to "
                "“In production”, then connect again.",
            )
        return (
            "auth",
            "Google revoked this connection. That happens if access was removed from your "
            "Google account, or the password changed. Reconnect to resume syncing.",
        )
    return ("auth", "Could not refresh access to your Google account. Reconnect to resume syncing.")


async def fetch_userinfo(access_token: str) -> dict[str, Any]:
    """Identity for the freshly granted token.

    `raise_for_status` here used to throw httpx.HTTPStatusError, which the
    callback did not catch — so a single non-200 from Google turned the whole
    consent flow into a 500 page.
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    except httpx.HTTPError as exc:
        raise ProviderError(
            "Could not reach Google to read your account details. Please try again.",
            error_class="provider_5xx",
        ) from exc
    if resp.status_code >= 400:
        logger.warning("google_userinfo_failed", status=resp.status_code)
        raise ProviderError("Google would not confirm which account this is.", error_class="auth", reason="no_identity")
    return dict(resp.json())


async def revoke(token: str) -> None:
    """Best-effort revocation on disconnect.

    Failure is logged and swallowed: the user asked to disconnect, and the
    local grant is being deleted either way. Leaving a dangling row because
    Google was briefly unreachable would be the worse outcome.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.HTTPError as exc:
        logger.warning("google_revoke_failed", error=str(exc))


def expires_at(payload: dict[str, Any]) -> datetime | None:
    seconds = payload.get("expires_in")
    if not seconds:
        return None
    try:
        # 60s of slack so a token cannot expire between the check and the call.
        return datetime.now(UTC) + timedelta(seconds=int(seconds) - 60)
    except (TypeError, ValueError):
        return None
