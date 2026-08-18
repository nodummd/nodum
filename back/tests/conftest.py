"""Shared test fixtures.

Unit tests use httpx.ASGITransport against the app with the database
dependency overridden — no real Postgres needed. Integration tests (marked)
expect the compose test environment.
"""

import os

os.environ.setdefault("ENVIRONMENT", "test")
# Every suite except the verification one signs up to get a token; making all
# of them walk the OTP step would add a dance to fifteen files and cover
# nothing new. tests/integration/test_email_verification.py turns it back on.
os.environ.setdefault("EMAIL_VERIFICATION_REQUIRED", "false")

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture(scope="session", autouse=True)
def s3_bucket() -> None:
    """ASGITransport skips app lifespan, so create the S3 bucket here.

    Suppress failures — if MinIO is down, attachment tests fail loudly anyway.
    """
    import contextlib

    from app.core.s3 import ensure_buckets_exist

    with contextlib.suppress(Exception):
        ensure_buckets_exist()


@pytest.fixture
async def client() -> AsyncClient:
    """HTTP client bound to the ASGI app (no network)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
