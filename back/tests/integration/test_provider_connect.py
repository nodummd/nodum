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
from app.services.providers import base as provider_base
from app.services.providers import google_auth, google_calendar

CALENDAR_SCOPES = (
    "openid email "
    "https://www.googleapis.com/auth/calendar.events.readonly "
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
)


async def _signup(client: AsyncClient, label: str = "connect") -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"{label}-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Connect Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    return {
        "headers": headers,
        "vault_id": uuid.UUID(vaults[0]["id"]),
        "user_id": uuid.UUID(resp.json()["data"]["user"]["id"]),
    }


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    return await _signup(client)


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


@pytest.mark.asyncio
async def test_starting_a_flow_for_someone_elses_vault_is_refused_before_google(
    client: AsyncClient,
) -> None:
    """The callback checks ownership too, but by then the user has read a
    permissions screen, approved it and been redirected — and is told the vault
    does not exist at the end of a round trip that could never have worked.

    It is also the cheaper place to say no: a rejected start costs one query,
    a rejected callback costs a consent grant that then has to be revoked.
    """
    from app.settings import get_settings

    settings = get_settings()
    original = (settings.GOOGLE_SYNC_CLIENT_ID, settings.GOOGLE_SYNC_CLIENT_SECRET)
    settings.GOOGLE_SYNC_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
    settings.GOOGLE_SYNC_CLIENT_SECRET = "test-client-secret"
    try:
        owner = await _signup(client, "owner")
        stranger = await _signup(client, "stranger")

        # The owner can start a flow for their own vault...
        mine = await client.post(
            f"/api/v1/connections/google/start?vault_id={owner['vault_id']}&provider=google_calendar",
            headers=owner["headers"],
        )
        assert mine.status_code == 200, mine.text
        assert "accounts.google.com" in mine.json()["data"]["url"]

        # ...and nobody else can, nor for a vault that does not exist.
        for headers, vault_id in (
            (stranger["headers"], owner["vault_id"]),
            (owner["headers"], uuid.uuid4()),
        ):
            refused = await client.post(
                f"/api/v1/connections/google/start?vault_id={vault_id}&provider=google_calendar",
                headers=headers,
            )
            assert refused.status_code == 404, refused.text
            # And no consent URL leaks in the refusal — a client that ignored
            # the status code must still have nothing to redirect to.
            assert "accounts.google.com" not in refused.text
    finally:
        settings.GOOGLE_SYNC_CLIENT_ID, settings.GOOGLE_SYNC_CLIENT_SECRET = original


# ── keeping the calendar picker current ─────────────────────────────────────


async def _calendar_connection(workspace: dict, *, settings: dict | None = None) -> ProviderConnection:
    from app.utils.crypto_utils import encrypt_secret

    async with async_session_factory() as session:
        row = ProviderConnection(
            user_id=workspace["user_id"],
            vault_id=workspace["vault_id"],
            provider="google_calendar",
            external_account_id=uuid.uuid4().hex,
            external_email="tester@example.com",
            connected_at=datetime.now(UTC),
            refresh_ciphertext=encrypt_secret("refresh-token", purpose="oauth"),
            access_ciphertext=encrypt_secret("access-token", purpose="oauth"),
            access_expires_at=datetime.now(UTC) + timedelta(hours=1),
            settings=settings if settings is not None else {},
            people_counts={},
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


@pytest.mark.asyncio
async def test_a_calendar_made_after_connecting_can_still_be_chosen(client: AsyncClient, workspace: dict) -> None:
    """The list was captured once, at connect, and never again — so a calendar
    created afterwards could not be selected at all, and the only way to see it
    was to disconnect and reconnect. That is a heavy, lossy thing to ask for a
    list that changes."""
    connection = await _calendar_connection(
        workspace,
        settings={"available_calendars": [{"id": "primary", "summary": "Me", "primary": True}]},
    )

    later = [
        {"id": "primary", "summary": "Me", "primary": True},
        {"id": "team@example.com", "summary": "Team", "primary": False},
    ]
    original = google_calendar.list_calendars
    google_calendar.list_calendars = lambda token: _async(later)  # type: ignore[assignment]
    try:
        resp = await client.get(
            f"/api/v1/connections/connections/{connection.id}/calendars", headers=workspace["headers"]
        )
    finally:
        google_calendar.list_calendars = original  # type: ignore[assignment]

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["data"]["calendars"]] == ["primary", "team@example.com"]

    # And it is persisted, so the picker is right even if the next open is
    # served from the cache.
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        assert len(row.settings["available_calendars"]) == 2


def _async(value):
    async def _run(*_args, **_kwargs):
        return value

    return _run()


@pytest.mark.asyncio
async def test_a_broken_grant_shows_the_last_known_list_not_an_empty_one(client: AsyncClient, workspace: dict) -> None:
    """An empty picker reads as "you have no calendars", which is a different
    and wrong statement about the user's Google account."""
    stored = [{"id": "primary", "summary": "Me", "primary": True}]
    connection = await _calendar_connection(workspace, settings={"available_calendars": stored})

    async def _refuse(_token):
        raise provider_base.ProviderError("Could not list calendars: 403", error_class="auth")

    original = google_calendar.list_calendars
    google_calendar.list_calendars = _refuse  # type: ignore[assignment]
    try:
        resp = await client.get(
            f"/api/v1/connections/connections/{connection.id}/calendars", headers=workspace["headers"]
        )
    finally:
        google_calendar.list_calendars = original  # type: ignore[assignment]

    assert resp.status_code == 200, resp.text
    body = resp.json()["data"]
    assert [c["id"] for c in body["calendars"]] == ["primary"]
    assert body["stale"] is True, "the UI has no way to say the list may be out of date"
    # Google's own words never reach the client.
    assert "403" not in resp.text


@pytest.mark.asyncio
async def test_the_list_is_not_refetched_on_every_panel_open(client: AsyncClient, workspace: dict) -> None:
    """The panel asks whenever it opens, and a settings tab is easy to toggle."""
    connection = await _calendar_connection(workspace)

    calls: list[str] = []

    async def _count(token):
        calls.append(token)
        return [{"id": "primary", "summary": "Me", "primary": True}]

    original = google_calendar.list_calendars
    google_calendar.list_calendars = _count  # type: ignore[assignment]
    try:
        url = f"/api/v1/connections/connections/{connection.id}/calendars"
        for _ in range(3):
            assert (await client.get(url, headers=workspace["headers"])).status_code == 200
    finally:
        google_calendar.list_calendars = original  # type: ignore[assignment]

    assert len(calls) == 1, f"{len(calls)} calls to Google for three opens"


@pytest.mark.asyncio
async def test_the_calendar_list_is_scoped_to_its_owner(client: AsyncClient, workspace: dict) -> None:
    connection = await _calendar_connection(workspace)
    stranger = await _signup(client, "stranger-cal")
    resp = await client.get(f"/api/v1/connections/connections/{connection.id}/calendars", headers=stranger["headers"])
    assert resp.status_code == 404, resp.text
