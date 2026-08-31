"""The state token, which is the only thing binding a callback to a person.

`/connections/google/callback` cannot be authenticated: Google drives that
request, not the browser session, and it arrives with no cookie of ours worth
trusting. So the whole flow rests on `state` — a value we minted, stored
against one user and one vault, and hand back only to the browser that asked.

Everything about how it behaves is security-relevant and none of it was
tested. It has to be unguessable, single-use, bound to the person who started
the flow, and expiring — and the callback has to refuse anything else without
telling the caller which part was wrong.
"""

import asyncio
import uuid

import pytest
from httpx import AsyncClient

from app.core.redis import redis_control
from app.services.providers import google_auth


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    from tests.integration.test_provider_connect import _signup

    return await _signup(client, "oauth-state")


@pytest.mark.asyncio
async def test_a_state_carries_the_user_and_vault_that_started_the_flow() -> None:
    user_id, vault_id = str(uuid.uuid4()), str(uuid.uuid4())
    url = await google_auth.build_start_url(user_id=user_id, vault_id=vault_id, scopes=["scope"])

    state = url.split("state=")[1].split("&")[0]
    assert await google_auth.consume_state(state) == (user_id, vault_id)


@pytest.mark.asyncio
async def test_a_state_is_single_use() -> None:
    """Otherwise a state that leaked — a referrer header, a shared screen, a
    proxy log — could be replayed to attach an attacker's Google account to
    the vault it names."""
    url = await google_auth.build_start_url(user_id=str(uuid.uuid4()), vault_id=str(uuid.uuid4()), scopes=[])
    state = url.split("state=")[1].split("&")[0]

    assert await google_auth.consume_state(state) is not None
    assert await google_auth.consume_state(state) is None, "the same state was accepted twice"


@pytest.mark.asyncio
async def test_a_state_nobody_issued_is_refused() -> None:
    assert await google_auth.consume_state("not-a-state-we-minted") is None
    assert await google_auth.consume_state("") is None


@pytest.mark.asyncio
async def test_a_state_is_long_enough_not_to_be_guessed() -> None:
    """It is the only secret in the flow, and the callback is unauthenticated."""
    urls = [
        await google_auth.build_start_url(user_id=str(uuid.uuid4()), vault_id=str(uuid.uuid4()), scopes=[])
        for _ in range(5)
    ]
    states = [url.split("state=")[1].split("&")[0] for url in urls]

    assert len(set(states)) == 5, "two flows were issued the same state"
    for state in states:
        assert len(state) >= 32, f"a {len(state)}-character state is guessable"


@pytest.mark.asyncio
async def test_a_state_expires() -> None:
    """A consent screen left open for a day must not still be usable."""
    url = await google_auth.build_start_url(user_id=str(uuid.uuid4()), vault_id=str(uuid.uuid4()), scopes=[])
    state = url.split("state=")[1].split("&")[0]

    ttl = await redis_control.ttl(google_auth._STATE_KEY.format(state=state))
    assert 0 < ttl <= google_auth._STATE_TTL


@pytest.mark.asyncio
async def test_a_corrupt_state_value_is_refused_rather_than_half_read() -> None:
    """`partition` on a value with no separator yields an empty vault id, and
    connecting "somewhere" is worse than not connecting."""
    for stored in ("", "only-a-user-id", ":only-a-vault-id"):
        state = f"probe-{uuid.uuid4().hex}"
        await redis_control.set(google_auth._STATE_KEY.format(state=state), stored, ex=60)
        assert await google_auth.consume_state(state) is None, f"{stored!r} was accepted"


@pytest.mark.asyncio
async def test_the_callback_refuses_a_forged_state_and_says_nothing_useful(
    client: AsyncClient,
) -> None:
    """The response must not distinguish "no such state" from "expired" or
    "wrong user" — the callback is unauthenticated, so any difference is an
    oracle for probing."""
    resp = await client.get(
        "/api/v1/connections/google/callback",
        params={"code": "an-authorisation-code", "state": "forged"},
        follow_redirects=False,
    )
    assert resp.status_code == 303
    location = resp.headers["location"]
    assert "connected=expired" in location
    # No reason code, and nothing echoed back from the request.
    assert "reason=" not in location
    assert "forged" not in location


@pytest.mark.asyncio
async def test_the_callback_refuses_a_missing_code_without_touching_a_state(
    client: AsyncClient,
) -> None:
    """A callback with no code cannot be completed, so it must not burn the
    state either — the user pressing back and retrying would otherwise find
    their own flow dead."""
    url = await google_auth.build_start_url(user_id=str(uuid.uuid4()), vault_id=str(uuid.uuid4()), scopes=[])
    state = url.split("state=")[1].split("&")[0]

    resp = await client.get(
        "/api/v1/connections/google/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert resp.status_code == 303
    assert "connected=denied" in resp.headers["location"]
    assert await google_auth.consume_state(state) is not None, "a cancelled attempt burned the state"


@pytest.mark.asyncio
async def test_two_flows_started_at_once_do_not_share_a_state() -> None:
    """Two tabs, two vaults. Each callback must land on the vault its own flow
    named."""
    pairs = [(str(uuid.uuid4()), str(uuid.uuid4())) for _ in range(4)]
    urls = await asyncio.gather(*(google_auth.build_start_url(user_id=u, vault_id=v, scopes=[]) for u, v in pairs))
    states = [url.split("state=")[1].split("&")[0] for url in urls]

    resolved = [await google_auth.consume_state(state) for state in states]
    assert resolved == pairs


# ── the redirect contract, through the real route ───────────────────────────
#
# The callback can only speak to the app through the URL it redirects to. The
# state tests above cover the refusals; these cover the two outcomes a user
# actually reaches, because the contract is what the client parses and a
# change to it fails silently in exactly the way the old code did.


async def _started_state(client: AsyncClient, workspace: dict) -> str:
    from app.settings import get_settings

    settings = get_settings()
    saved = (settings.GOOGLE_SYNC_CLIENT_ID, settings.GOOGLE_SYNC_CLIENT_SECRET)
    settings.GOOGLE_SYNC_CLIENT_ID = "test-client.apps.googleusercontent.com"
    settings.GOOGLE_SYNC_CLIENT_SECRET = "test-secret"
    try:
        resp = await client.post(
            f"/api/v1/connections/google/start?vault_id={workspace['vault_id']}&provider=google_calendar",
            headers=workspace["headers"],
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["data"]["url"].split("state=")[1].split("&")[0]
    finally:
        settings.GOOGLE_SYNC_CLIENT_ID, settings.GOOGLE_SYNC_CLIENT_SECRET = saved


@pytest.mark.asyncio
async def test_a_completed_connect_lands_the_user_back_with_connected_ok(client: AsyncClient, workspace: dict) -> None:
    from tests.integration.test_provider_connect import _Google

    state = await _started_state(client, workspace)
    with _Google():
        resp = await client.get(
            "/api/v1/connections/google/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

    assert resp.status_code == 303
    assert resp.headers["location"].endswith("/vault?connected=ok")


@pytest.mark.asyncio
async def test_a_failed_connect_carries_a_reason_the_client_knows(client: AsyncClient, workspace: dict) -> None:
    """A grant with no usable scopes. The reason has to be a code from the
    closed set, because the client owns the words — and a code it does not
    recognise degrades to generic copy rather than being echoed."""
    from app.api.v1.integrations import CALLBACK_REASONS
    from tests.integration.test_provider_connect import _Google

    state = await _started_state(client, workspace)
    with _Google(scope="openid email"):
        resp = await client.get(
            "/api/v1/connections/google/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

    assert resp.status_code == 303
    location = resp.headers["location"]
    assert "connected=failed" in location, location
    assert "reason=" in location, f"no reason in {location!r}"
    reason = location.split("reason=")[1]
    assert reason == "no_scopes"
    assert reason in CALLBACK_REASONS


@pytest.mark.asyncio
async def test_the_callback_never_returns_an_error_page(client: AsyncClient, workspace: dict) -> None:
    """It is a top-level browser redirect. Anything but a 303 is a raw error
    page shown to someone mid-flow, with the authorisation code already spent
    and no way back except starting over."""
    from tests.integration.test_provider_connect import _Google

    class _Exploding(_Google):
        async def _exchange(self, code: str) -> dict:
            raise RuntimeError("something nobody anticipated")

    state = await _started_state(client, workspace)
    with _Exploding():
        resp = await client.get(
            "/api/v1/connections/google/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

    assert resp.status_code == 303, resp.text
    assert "connected=failed" in resp.headers["location"]


@pytest.mark.asyncio
async def test_starting_a_flow_for_a_provider_this_server_will_not_run(client: AsyncClient, workspace: dict) -> None:
    """Gmail is off unless an operator turned it on, and an unknown provider is
    a different answer from a disabled one — the first is a mistake, the second
    is a policy the user should be told about."""
    from app.settings import get_settings

    settings = get_settings()
    saved = (settings.GOOGLE_SYNC_CLIENT_ID, settings.GOOGLE_SYNC_CLIENT_SECRET)
    settings.GOOGLE_SYNC_CLIENT_ID = "test-client.apps.googleusercontent.com"
    settings.GOOGLE_SYNC_CLIENT_SECRET = "test-secret"
    try:
        disabled = await client.post(
            f"/api/v1/connections/google/start?vault_id={workspace['vault_id']}&provider=google_gmail",
            headers=workspace["headers"],
        )
        assert disabled.status_code == 422, disabled.text
        assert "self-hosted" in disabled.json()["error"]["message"]

        unknown = await client.post(
            f"/api/v1/connections/google/start?vault_id={workspace['vault_id']}&provider=notion",
            headers=workspace["headers"],
        )
        assert unknown.status_code == 404, unknown.text
    finally:
        settings.GOOGLE_SYNC_CLIENT_ID, settings.GOOGLE_SYNC_CLIENT_SECRET = saved

    # And with no client configured at all, the message names what to set.
    unconfigured = await client.post(
        f"/api/v1/connections/google/start?vault_id={workspace['vault_id']}&provider=google_calendar",
        headers=workspace["headers"],
    )
    assert unconfigured.status_code == 422
    assert "GOOGLE_SYNC_CLIENT_ID" in unconfigured.json()["error"]["message"]
