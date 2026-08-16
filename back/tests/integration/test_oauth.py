"""Google OAuth — env-gated, tested entirely against mocked Google endpoints."""

import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient

from app.services import oauth_service
from app.settings import get_settings


@pytest.fixture
def google_enabled(monkeypatch: pytest.MonkeyPatch):
    s = get_settings()
    monkeypatch.setattr(s, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(s, "GOOGLE_CLIENT_SECRET", "test-secret")
    return s


def _mock_google(
    monkeypatch: pytest.MonkeyPatch,
    *,
    sub: str,
    email: str,
    name: str = "Mock User",
    email_verified: object = True,
):
    async def fake_exchange(code: str) -> str:
        assert code == "good-code"
        return "mock-access-token"

    async def fake_userinfo(token: str) -> dict:
        assert token == "mock-access-token"
        return {"sub": sub, "email": email, "name": name, "email_verified": email_verified}

    monkeypatch.setattr(oauth_service, "_exchange_code", fake_exchange)
    monkeypatch.setattr(oauth_service, "_fetch_userinfo", fake_userinfo)


async def _start_state(client: AsyncClient) -> str:
    resp = await client.get("/api/v1/auth/google/start", follow_redirects=False)
    assert resp.status_code == 307
    location = resp.headers["location"]
    assert location.startswith("https://accounts.google.com/")
    return parse_qs(urlparse(location).query)["state"][0]


async def test_start_404_when_disabled(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # real credentials may exist in .env — force-disable for this test
    s = get_settings()
    monkeypatch.setattr(s, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(s, "GOOGLE_CLIENT_SECRET", "")
    resp = await client.get("/api/v1/auth/google/start", follow_redirects=False)
    assert resp.status_code == 404


async def test_providers_flag(client: AsyncClient, google_enabled) -> None:
    resp = await client.get("/api/v1/auth/providers")
    assert resp.json()["data"]["google"] is True


async def test_callback_creates_user_with_vault(
    client: AsyncClient, google_enabled, monkeypatch: pytest.MonkeyPatch
) -> None:
    email = f"oauth-{uuid.uuid4().hex[:12]}@nodumtest.dev"
    _mock_google(monkeypatch, sub=f"sub-{email}", email=email)

    state = await _start_state(client)
    resp = await client.get(f"/api/v1/auth/google/callback?code=good-code&state={state}", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"].endswith("/")
    assert "nodum_refresh=" in resp.headers.get("set-cookie", "")

    # The refresh cookie works → session is real; the welcome vault exists
    refresh = await client.post("/api/v1/auth/refresh")
    assert refresh.status_code == 200, refresh.text
    token = refresh.json()["data"]["access_token"]
    client.cookies.clear()
    vaults = await client.get("/api/v1/vaults", headers={"Authorization": f"Bearer {token}"})
    assert len(vaults.json()["data"]) == 1


async def test_callback_links_existing_email_account(
    client: AsyncClient, google_enabled, monkeypatch: pytest.MonkeyPatch
) -> None:
    email = f"linkme-{uuid.uuid4().hex[:12]}@nodumtest.dev"
    signup = await client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "s3cure-Password!", "name": "Existing"},
    )
    existing_id = signup.json()["data"]["user"]["id"]
    client.cookies.clear()

    _mock_google(monkeypatch, sub=f"sub-{email}", email=email)
    state = await _start_state(client)
    resp = await client.get(f"/api/v1/auth/google/callback?code=good-code&state={state}", follow_redirects=False)
    assert resp.status_code == 307

    refresh = await client.post("/api/v1/auth/refresh")
    assert refresh.json()["data"]["user"]["id"] == existing_id
    client.cookies.clear()


async def test_callback_rejects_bad_state(client: AsyncClient, google_enabled, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_google(monkeypatch, sub="sub-x", email="x@nodumtest.dev")
    resp = await client.get("/api/v1/auth/google/callback?code=good-code&state=forged", follow_redirects=False)
    assert resp.status_code == 307
    assert "error=oauth" in resp.headers["location"]


async def test_repeat_callback_reuses_user(
    client: AsyncClient, google_enabled, monkeypatch: pytest.MonkeyPatch
) -> None:
    email = f"repeat-{uuid.uuid4().hex[:12]}@nodumtest.dev"
    _mock_google(monkeypatch, sub=f"sub-{email}", email=email)

    ids = []
    for _ in range(2):
        state = await _start_state(client)
        resp = await client.get(f"/api/v1/auth/google/callback?code=good-code&state={state}", follow_redirects=False)
        assert resp.status_code == 307
        refresh = await client.post("/api/v1/auth/refresh")
        ids.append(refresh.json()["data"]["user"]["id"])
        client.cookies.clear()
    assert ids[0] == ids[1]


async def test_callback_rejects_unverified_google_email(
    client: AsyncClient, google_enabled, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An unverified address proves nothing about who is driving the flow.

    Without this guard, anyone who can present a Google identity carrying a
    victim's address is signed straight into that victim's account.
    """
    email = f"unverified-{uuid.uuid4().hex[:12]}@nodumtest.dev"
    _mock_google(monkeypatch, sub=f"sub-{email}", email=email, email_verified=False)
    state = await _start_state(client)

    resp = await client.get(f"/api/v1/auth/google/callback?code=good-code&state={state}", follow_redirects=False)
    assert resp.status_code == 307
    assert "error" in resp.headers["location"]

    # And no account was quietly created for it.
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "whatever"})
    assert login.status_code == 401
    client.cookies.clear()


async def test_linking_google_kills_sessions_held_before_the_link(
    client: AsyncClient, google_enabled, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Closes the pre-registration hijack.

    Someone who signs up with an address they do not own keeps a live session
    until the real owner arrives via Google. Linking must evict them — while
    leaving the session just minted for the genuine owner working.
    """
    email = f"prereg-{uuid.uuid4().hex[:12]}@nodumtest.dev"
    signup = await client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "s3cure-Password!", "name": "Squatter"},
    )
    squatter_access = signup.json()["data"]["access_token"]
    client.cookies.clear()

    # The squatter's token works right up until the link.
    before = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {squatter_access}"})
    assert before.status_code == 200

    _mock_google(monkeypatch, sub=f"sub-{email}", email=email)
    state = await _start_state(client)
    resp = await client.get(f"/api/v1/auth/google/callback?code=good-code&state={state}", follow_redirects=False)
    assert resp.status_code == 307

    after = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {squatter_access}"})
    assert after.status_code == 401, "the pre-existing session survived account linking"

    # The owner's brand-new session must NOT have been caught in the sweep —
    # this is why linking revokes per-session instead of using the user-wide
    # marker, which kills anything minted in the same second.
    owner = await client.post("/api/v1/auth/refresh")
    assert owner.status_code == 200
    assert owner.json()["data"]["user"]["email"] == email
    client.cookies.clear()
