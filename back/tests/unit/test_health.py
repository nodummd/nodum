"""Health endpoint smoke tests."""

from httpx import AsyncClient


async def test_health_returns_status(client: AsyncClient) -> None:
    """Health endpoint responds with a status payload (may be degraded without infra)."""
    response = await client.get("/health")
    assert response.status_code in (200, 503)
    body = response.json()
    assert body["status"] in ("healthy", "degraded")
    assert "checks" in body
