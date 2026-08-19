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


@pytest.fixture(scope="session", autouse=True)
async def mcp_session_manager():
    """ASGITransport skips app lifespan, and the MCP transport needs its
    session manager running (the lifespan does that in the real app). One per
    test session — it can only be started once per process."""
    import asyncio

    from app.mcp.server import server as mcp_server

    # Enter and exit the manager's task group from ONE task: anyio refuses to
    # close a cancel scope from a task other than the one that opened it, and
    # a session fixture's setup and teardown are not guaranteed the same task.
    stop = asyncio.Event()
    started = asyncio.Event()

    async def keep_running() -> None:
        async with mcp_server.session_manager.run():
            started.set()
            await stop.wait()

    runner = asyncio.create_task(keep_running())
    await started.wait()
    yield
    stop.set()
    await runner


@pytest.fixture
async def client() -> AsyncClient:
    """HTTP client bound to the ASGI app (no network)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
