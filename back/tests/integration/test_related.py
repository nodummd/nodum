"""Semantic related-notes tests (hash embedder)."""

import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"rel-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Rel Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    return {"headers": headers, "base": f"/api/v1/vaults/{vault_id}"}


async def test_related_ranks_by_content_similarity(client: AsyncClient, workspace: dict) -> None:
    async def create(title: str, content: str) -> str:
        r = await client.post(
            f"{workspace['base']}/notes",
            json={"title": title, "content": content},
            headers=workspace["headers"],
        )
        assert r.status_code == 201, r.text
        return r.json()["data"]["id"]

    coffee_a = await create(
        "Espresso extraction",
        "Espresso extraction depends on grind size, water temperature and pressure. "
        "Dial in the grinder until the espresso shot runs 25 seconds.",
    )
    coffee_b = await create(
        "Grinder maintenance",
        "Clean the espresso grinder burrs weekly. Grind size drifts as burrs wear, changing extraction and shot time.",
    )
    await create(
        "Gardening notes",
        "Tomato seedlings need full sun, regular watering and rich compost soil.",
    )

    resp = await client.get(f"{workspace['base']}/notes/{coffee_a}/related", headers=workspace["headers"])
    assert resp.status_code == 200, resp.text
    related = resp.json()["data"]["related"]
    assert related, "should find related notes"
    # The other coffee note must outrank gardening
    titles = [r["title"] for r in related]
    assert titles[0] == "Grinder maintenance"
    if "Gardening notes" in titles:
        assert titles.index("Grinder maintenance") < titles.index("Gardening notes")
    # Similarity is exposed and sane
    assert 0 < related[0]["similarity"] <= 1
