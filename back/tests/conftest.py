"""Shared test fixtures.

Unit tests use httpx.ASGITransport against the app with the database
dependency overridden — no real Postgres needed. Integration tests (marked)
expect the compose test environment.
"""

import os

os.environ.setdefault("ENVIRONMENT", "test")

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client() -> AsyncClient:
    """HTTP client bound to the ASGI app (no network)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
