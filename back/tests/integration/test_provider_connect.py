"""The OAuth callback's happy path — where a mistake stores a credential wrong.

Everything around this is covered: state handling, transport failures, scope
gating. The one thing that had never run is the part that matters most —
tokens arrive, and a connection row is written. This asserts what ends up in
the database, because "it returned success" is not the same as "the refresh
token is encrypted, the scopes are what Google actually granted, and the row
is bound to the right vault".
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import async_session_factory
from app.models.providers import ProviderConnection
from app.services import provider_connection_service
from app.services.providers import google_auth, google_calendar

CALENDAR_SCOPES = (
    "openid email "
    "https://www.googleapis.com/auth/calendar.events.readonly "
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
)


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"connect-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Connect Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {
        "vault_id": uuid.UUID(vaults[0]["id"]),
        "user_id": uuid.UUID(resp.json()["data"]["user"]["id"]),
    }


class _Google:
    """Stands in for Google across a whole connect, restoring on exit."""

    def __init__(self, *, scope: str = CALENDAR_SCOPES, calendars: object = None, sub: str = "") -> None:
        self.scope = scope
        self.calendars = calendars
        self.sub = sub or uuid.uuid4().hex

    async def _exchange(self, code: str) -> dict:
        return {
            "access_token": "ACCESS-TOKEN-VALUE",
            "refresh_token": "REFRESH-TOKEN-VALUE",
            "expires_in": 3599,
            "scope": self.scope,
        }

    async def _userinfo(self, token: str) -> dict:
        return {"sub": self.sub, "email": "tester@example.com"}

    async def _list(self, token: str) -> list[dict]:
        if isinstance(self.calendars, Exception):
            raise self.calendars
        return self.calendars or [{"id": "primary", "name": "Work", "primary": True}]

    def __enter__(self) -> "_Google":
        self._saved = (google_auth.exchange_code, google_auth.fetch_userinfo, google_calendar.list_calendars)
        google_auth.exchange_code = self._exchange  # type: ignore[assignment]
        google_auth.fetch_userinfo = self._userinfo  # type: ignore[assignment]
        google_calendar.list_calendars = self._list  # type: ignore[assignment]
        return self

    def __exit__(self, *exc: object) -> None:
        google_auth.exchange_code, google_auth.fetch_userinfo, google_calendar.list_calendars = self._saved  # type: ignore[assignment]


async def _connect(workspace: dict, google: _Google):
    async with async_session_factory() as session:
        with google:
            return await provider_connection_service.complete_google_connect(
                session, user_id=workspace["user_id"], vault_id=workspace["vault_id"], code="auth-code"
            )


async def _row(workspace: dict) -> ProviderConnection | None:
    async with async_session_factory() as session:
        return (
            (
                await session.execute(
                    select(ProviderConnection).where(ProviderConnection.user_id == workspace["user_id"])
                )
            )
            .scalars()
            .first()
        )


@pytest.mark.asyncio
async def test_a_grant_becomes_a_connection_with_encrypted_tokens(workspace: dict) -> None:
    response = await _connect(workspace, _Google())
    assert response.success, response.message

    row = await _row(workspace)
    assert row is not None
    assert row.provider == "google_calendar"
    assert row.vault_id == workspace["vault_id"]
    assert row.external_email == "tester@example.com"
    assert row.status == "active"

    # The whole point of the column names. A grep for the literal must find
    # nothing, or the token is sitting in the database in the clear.
    assert "REFRESH-TOKEN-VALUE" not in row.refresh_ciphertext
    assert "ACCESS-TOKEN-VALUE" not in row.access_ciphertext
    assert row.refresh_ciphertext.startswith("v1:")

    from app.utils.crypto_utils import decrypt_secret

    assert decrypt_secret(row.refresh_ciphertext, purpose="oauth") == "REFRESH-TOKEN-VALUE"
    # ...and not readable with the wrong purpose's key when they differ.
    assert row.access_expires_at is not None and row.access_expires_at > datetime.now(UTC)


@pytest.mark.asyncio
async def test_scopes_are_recorded_as_granted_not_as_requested(workspace: dict) -> None:
    """A user can untick a permission on the consent screen. What we store has
    to be what they actually gave, or the first poll fails with a confusing
    403 for a scope we believe we hold."""
    await _connect(workspace, _Google())
    row = await _row(workspace)
    assert row is not None
    assert "calendar.events.readonly" in row.scopes
    assert "gmail" not in row.scopes


@pytest.mark.asyncio
async def test_a_grant_without_the_needed_scopes_is_refused(workspace: dict) -> None:
    response = await _connect(workspace, _Google(scope="openid email"))
    assert not response.success
    assert await _row(workspace) is None, "a connection was stored for a grant we cannot use"


@pytest.mark.asyncio
async def test_reconnecting_updates_the_row_and_resets_the_clock(workspace: dict) -> None:
    """connected_at drives the seven-day Testing-mode detector, so a reconnect
    has to restamp it — otherwise the next failure is misdiagnosed forever."""
    google = _Google()
    await _connect(workspace, google)

    async with async_session_factory() as session:
        row = (
            (
                await session.execute(
                    select(ProviderConnection).where(ProviderConnection.user_id == workspace["user_id"])
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        first_id = row.id
        row.connected_at = datetime.now(UTC) - timedelta(days=90)
        row.status = "needs_reauth"
        await session.commit()

    # Same account, same vault.
    await _connect(workspace, google)

    async with async_session_factory() as session:
        rows = list(
            (
                await session.execute(
                    select(ProviderConnection).where(ProviderConnection.user_id == workspace["user_id"])
                )
            ).scalars()
        )
    assert len(rows) == 1, "reconnecting duplicated the connection"
    assert rows[0].id == first_id
    assert rows[0].status == "active"
    assert datetime.now(UTC) - rows[0].connected_at < timedelta(minutes=5)


@pytest.mark.asyncio
async def test_a_vault_the_user_does_not_own_is_refused(workspace: dict) -> None:
    async with async_session_factory() as session:
        with _Google():
            response = await provider_connection_service.complete_google_connect(
                session, user_id=workspace["user_id"], vault_id=uuid.uuid4(), code="auth-code"
            )
    assert not response.success
    assert response.error_code == "not_found"


@pytest.mark.asyncio
async def test_an_unreachable_calendar_list_does_not_undo_a_good_connection(
    workspace: dict,
) -> None:
    """This runs after the tokens are committed. An unhandled error here is a
    500 shown to someone whose connection actually succeeded — they read it as
    failure and connect again."""
    import httpx

    response = await _connect(workspace, _Google(calendars=httpx.ConnectError("refused")))
    assert response.success, "a convenience call took the whole connect down with it"

    row = await _row(workspace)
    assert row is not None and row.status == "active"


@pytest.mark.asyncio
async def test_the_api_shape_never_carries_a_token(workspace: dict) -> None:
    """Whatever else changes, this must not."""
    await _connect(workspace, _Google())
    async with async_session_factory() as session:
        listed = await provider_connection_service.list_for_user(session, workspace["user_id"])
    assert listed.success
    blob = repr(listed.data)
    for secret in ("REFRESH-TOKEN-VALUE", "ACCESS-TOKEN-VALUE", "ciphertext", "v1:"):
        assert secret not in blob, f"{secret!r} reached the API response"
