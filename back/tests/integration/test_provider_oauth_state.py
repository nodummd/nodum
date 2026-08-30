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
