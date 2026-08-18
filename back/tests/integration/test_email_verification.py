"""Email verification flow — requires the dev/test infra (postgres) up.

The rest of the suite runs with verification off (see tests/conftest.py), so
these tests switch it on for their duration. Outside production the code is the
fixed EMAIL_OTP_DEV_CODE and nothing is mailed.
"""

import uuid

import pytest
from httpx import AsyncClient

from app.settings import get_settings


@pytest.fixture
def verification_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the feature on for one test (settings are a cached singleton)."""
    monkeypatch.setattr(get_settings(), "EMAIL_VERIFICATION_REQUIRED", True)


def _creds() -> dict[str, str]:
    return {
        "email": f"verify-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "Verify User",
    }


@pytest.mark.usefixtures("verification_on")
async def test_signup_withholds_tokens_until_the_code_comes_back(client: AsyncClient) -> None:
    creds = _creds()
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]
    assert data["status"] == "verification_required"
    assert data["email"] == creds["email"]
    assert "access_token" not in data

    verified = await client.post(
        "/api/v1/auth/verify-email",
        json={"email": creds["email"], "code": get_settings().EMAIL_OTP_DEV_CODE},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["data"]["access_token"]
    assert verified.json()["data"]["user"]["email_verified"] is True


@pytest.mark.usefixtures("verification_on")
async def test_login_is_blocked_until_verified(client: AsyncClient) -> None:
    creds = _creds()
    await client.post("/api/v1/auth/signup", json=creds)

    blocked = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "email_not_verified"

    await client.post(
        "/api/v1/auth/verify-email",
        json={"email": creds["email"], "code": get_settings().EMAIL_OTP_DEV_CODE},
    )
    client.cookies.clear()
    ok = await client.post("/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]})
    assert ok.status_code == 200, ok.text


@pytest.mark.usefixtures("verification_on")
async def test_wrong_code_counts_down_then_locks_the_code_out(client: AsyncClient) -> None:
    creds = _creds()
    await client.post("/api/v1/auth/signup", json=creds)
    settings = get_settings()

    for _ in range(settings.EMAIL_OTP_MAX_ATTEMPTS):
        bad = await client.post("/api/v1/auth/verify-email", json={"email": creds["email"], "code": "000000"})
        assert bad.status_code == 422
        assert bad.json()["error"]["code"] == "invalid_code"

    # Attempts exhausted: even the right code is refused until a new one is sent.
    spent = await client.post(
        "/api/v1/auth/verify-email",
        json={"email": creds["email"], "code": settings.EMAIL_OTP_DEV_CODE},
    )
    assert spent.status_code == 422
    assert spent.json()["error"]["code"] == "too_many_attempts"


@pytest.mark.usefixtures("verification_on")
async def test_resend_is_cooled_down_and_never_leaks_account_existence(client: AsyncClient) -> None:
    creds = _creds()
    await client.post("/api/v1/auth/signup", json=creds)

    # Immediately after signup the cooldown is still running.
    too_soon = await client.post("/api/v1/auth/resend-verification", json={"email": creds["email"]})
    assert too_soon.status_code == 429
    assert too_soon.json()["error"]["code"] == "rate_limited"

    # An address with no account gets the same answer as one that needs a code.
    unknown = await client.post("/api/v1/auth/resend-verification", json={"email": "nobody-here@nodumtest.dev"})
    assert unknown.status_code == 200
    assert "on its way" in unknown.json()["data"]["message"]


@pytest.mark.usefixtures("verification_on")
async def test_verify_does_not_reveal_which_addresses_exist(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/auth/verify-email", json={"email": "ghost@nodumtest.dev", "code": "123456"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_code"


async def test_signup_logs_straight_in_when_verification_is_off(client: AsyncClient) -> None:
    """The self-hosted default path: no provider, no code, tokens immediately."""
    resp = await client.post("/api/v1/auth/signup", json=_creds())
    assert resp.status_code == 201
    assert resp.json()["data"]["access_token"]
