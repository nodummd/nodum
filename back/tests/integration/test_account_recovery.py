"""Password reset and account deletion — both gated on a mailed code.

Needs the dev/test infra (postgres). Outside production the code is the fixed
EMAIL_OTP_DEV_CODE and nothing is mailed.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.settings import get_settings


def _creds() -> dict[str, str]:
    return {
        "email": f"recover-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "Recover User",
    }


async def _account(client: AsyncClient) -> tuple[dict[str, str], str]:
    """A verified account and its access token."""
    creds = _creds()
    resp = await client.post("/api/v1/auth/signup", json=creds)
    data = resp.json()["data"]
    if "access_token" not in data:  # verification is on for this run
        data = (
            await client.post(
                "/api/v1/auth/verify-email",
                json={"email": creds["email"], "code": get_settings().EMAIL_OTP_DEV_CODE},
            )
        ).json()["data"]
    client.cookies.clear()
    return creds, data["access_token"]


# ── Password reset ───────────────────────────────────────────────────────────


async def test_reset_replaces_the_password_and_signs_in(client: AsyncClient) -> None:
    creds, _ = await _account(client)
    code = get_settings().EMAIL_OTP_DEV_CODE

    assert (await client.post("/api/v1/auth/forgot-password", json={"email": creds["email"]})).status_code == 200

    reset = await client.post(
        "/api/v1/auth/reset-password",
        json={"email": creds["email"], "code": code, "new_password": "a-Brand-New-Pass1"},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["data"]["access_token"]

    client.cookies.clear()
    old = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert old.status_code == 401, "the old password must stop working"

    new = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": "a-Brand-New-Pass1"})
    assert new.status_code == 200, new.text


async def test_reset_kills_sessions_that_existed_before_it(client: AsyncClient) -> None:
    """The point of a reset is losing control of the account — an intruder's
    refresh token must not survive it."""
    creds, token = await _account(client)
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 200

    await client.post("/api/v1/auth/forgot-password", json={"email": creds["email"]})
    await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": creds["email"],
            "code": get_settings().EMAIL_OTP_DEV_CODE,
            "new_password": "a-Brand-New-Pass1",
        },
    )

    stale = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert stale.status_code == 401


async def test_forgot_password_says_nothing_about_who_has_an_account(client: AsyncClient) -> None:
    known, _ = await _account(client)
    a = await client.post("/api/v1/auth/forgot-password", json={"email": known["email"]})
    b = await client.post("/api/v1/auth/forgot-password", json={"email": "ghost@nodumtest.dev"})
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()


async def test_a_signup_code_cannot_reset_a_password(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Purpose scoping: the code sitting in the inbox from signing up is not a
    reset code, even though both are six digits and both are live."""
    # Verification on, so the signup really does mint a code — otherwise this
    # would pass merely because no code exists at all.
    monkeypatch.setattr(get_settings(), "EMAIL_VERIFICATION_REQUIRED", True)
    creds = _creds()
    signup = await client.post("/api/v1/auth/signup", json=creds)
    assert signup.json()["data"]["status"] == "verification_required"

    attempt = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": creds["email"],
            "code": get_settings().EMAIL_OTP_DEV_CODE,
            "new_password": "a-Brand-New-Pass1",
        },
    )
    assert attempt.status_code == 422
    assert attempt.json()["error"]["code"] == "invalid_code"


# ── Account deletion ─────────────────────────────────────────────────────────


async def test_deletion_needs_a_code_that_was_actually_requested(client: AsyncClient) -> None:
    _, token = await _account(client)
    auth = {"Authorization": f"Bearer {token}"}

    early = await client.post(
        "/api/v1/auth/delete-account", json={"code": get_settings().EMAIL_OTP_DEV_CODE}, headers=auth
    )
    assert early.status_code == 422
    assert early.json()["error"]["code"] == "invalid_code"


async def test_deletion_removes_the_account_and_its_vaults(client: AsyncClient) -> None:
    from app.core.db import async_session_factory
    from app.models.auth import User
    from app.models.vaults import Vault

    creds, token = await _account(client)
    auth = {"Authorization": f"Bearer {token}"}

    async with async_session_factory() as db:
        user_id = await db.scalar(select(User.id).where(User.email == creds["email"]))
        vaults_before = len(list((await db.execute(select(Vault.id).where(Vault.user_id == user_id))).scalars()))
    assert vaults_before >= 1, "signup seeds a welcome vault"

    assert (await client.post("/api/v1/auth/delete-account/request", headers=auth)).status_code == 200
    gone = await client.post(
        "/api/v1/auth/delete-account", json={"code": get_settings().EMAIL_OTP_DEV_CODE}, headers=auth
    )
    assert gone.status_code == 200, gone.text

    async with async_session_factory() as db:
        assert await db.scalar(select(User.id).where(User.email == creds["email"])) is None
        assert list((await db.execute(select(Vault.id).where(Vault.user_id == user_id))).scalars()) == []

    # The session it was deleted from is dead, and so is the login.
    assert (await client.get("/api/v1/auth/me", headers=auth)).status_code == 401
    client.cookies.clear()
    assert (
        await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    ).status_code == 401


async def test_deletion_needs_authentication(client: AsyncClient) -> None:
    assert (await client.post("/api/v1/auth/delete-account/request")).status_code == 401
    assert (await client.post("/api/v1/auth/delete-account", json={"code": "123456"})).status_code == 401


@pytest.mark.parametrize("bad_code", ["000000", "111111"])
async def test_a_wrong_deletion_code_leaves_the_account_alone(client: AsyncClient, bad_code: str) -> None:
    _, token = await _account(client)
    auth = {"Authorization": f"Bearer {token}"}
    await client.post("/api/v1/auth/delete-account/request", headers=auth)

    refused = await client.post("/api/v1/auth/delete-account", json={"code": bad_code}, headers=auth)
    assert refused.status_code == 422
    assert (await client.get("/api/v1/auth/me", headers=auth)).status_code == 200


async def test_a_second_deletion_code_request_is_cooled_down(client: AsyncClient) -> None:
    """Anyone holding a session can press this button; forcing a send every
    time would let them spam the owner's inbox and the sending quota."""
    _, token = await _account(client)
    auth = {"Authorization": f"Bearer {token}"}

    assert (await client.post("/api/v1/auth/delete-account/request", headers=auth)).status_code == 200
    again = await client.post("/api/v1/auth/delete-account/request", headers=auth)
    assert again.status_code == 429
    assert again.json()["error"]["code"] == "rate_limited"

    # The code from the first request is still the live one.
    gone = await client.post(
        "/api/v1/auth/delete-account", json={"code": get_settings().EMAIL_OTP_DEV_CODE}, headers=auth
    )
    assert gone.status_code == 200, gone.text


async def test_repeat_forgot_password_stays_neutral(client: AsyncClient) -> None:
    """The cooldown must not become an oracle: asking twice in a row has to
    look the same for a real address as for one with no account."""
    creds, _ = await _account(client)

    real_first = await client.post("/api/v1/auth/forgot-password", json={"email": creds["email"]})
    real_second = await client.post("/api/v1/auth/forgot-password", json={"email": creds["email"]})
    ghost_first = await client.post("/api/v1/auth/forgot-password", json={"email": "ghost@nodumtest.dev"})
    ghost_second = await client.post("/api/v1/auth/forgot-password", json={"email": "ghost@nodumtest.dev"})

    assert real_first.status_code == real_second.status_code == 200
    assert ghost_first.status_code == ghost_second.status_code == 200
    assert real_second.json() == ghost_second.json()

    # And the code from the first request is still the live one.
    reset = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "email": creds["email"],
            "code": get_settings().EMAIL_OTP_DEV_CODE,
            "new_password": "a-Brand-New-Pass1",
        },
    )
    assert reset.status_code == 200, reset.text
