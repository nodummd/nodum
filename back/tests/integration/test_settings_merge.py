"""Concurrent PATCH /auth/me calls must not lose each other's settings keys.

The tour and the demo answer fire two PATCHes in the same click; before the
row lock, the second read happened before the first write and one key vanished.
"""

import asyncio
import uuid

from httpx import AsyncClient


async def test_concurrent_settings_patches_both_land(client: AsyncClient) -> None:
    creds = {
        "email": f"merge-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "Merge",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}

    for _ in range(5):  # a race, so give it a few chances to lose
        keys = [f"k{i}_{uuid.uuid4().hex[:4]}" for i in range(6)]
        await asyncio.gather(
            *(client.patch("/api/v1/auth/me", json={"settings": {k: True}}, headers=headers) for k in keys)
        )
        me = (await client.get("/api/v1/auth/me", headers=headers)).json()["data"]["settings"]
        missing = [k for k in keys if me.get(k) is not True]
        assert missing == [], f"concurrent PATCHes lost keys: {missing}"
