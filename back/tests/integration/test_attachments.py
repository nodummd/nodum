"""Attachment integration tests — require dev infra (incl. MinIO) up."""

import uuid

import httpx
import pytest
from httpx import AsyncClient

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c62f8ffff3f0300060502fe58c8e8500000000049454e44ae426082"
)


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"att-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Attach Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {resp.json()['data']['access_token']}"}
    vault_id = (await client.get("/api/v1/vaults", headers=headers)).json()["data"][0]["id"]
    return {"headers": headers, "base": f"/api/v1/vaults/{vault_id}"}


async def test_upload_list_resolve_download_delete(client: AsyncClient, workspace: dict) -> None:
    up = await client.post(
        f"{workspace['base']}/attachments",
        files={"file": ("diagram.png", PNG_BYTES, "image/png")},
        headers=workspace["headers"],
    )
    assert up.status_code == 201, up.text
    att = up.json()["data"]
    assert att["filename"] == "diagram.png"
    assert att["size_bytes"] == len(PNG_BYTES)

    # duplicate filename gets a suffix
    up2 = await client.post(
        f"{workspace['base']}/attachments",
        files={"file": ("diagram.png", PNG_BYTES, "image/png")},
        headers=workspace["headers"],
    )
    assert up2.json()["data"]["filename"] == "diagram 1.png"

    listed = await client.get(f"{workspace['base']}/attachments", headers=workspace["headers"])
    assert {a["filename"] for a in listed.json()["data"]} == {"diagram.png", "diagram 1.png"}

    # resolve by filename (the ![[embed]] path) and actually fetch from MinIO
    resolved = await client.get(
        f"{workspace['base']}/attachments/resolve",
        params={"filename": "diagram.png"},
        headers=workspace["headers"],
    )
    assert resolved.status_code == 200
    url = resolved.json()["data"]["url"]
    async with httpx.AsyncClient() as raw:
        blob = await raw.get(url)
        assert blob.status_code == 200
        assert blob.content == PNG_BYTES

    deleted = await client.delete(
        f"{workspace['base']}/attachments/{att['id']}", headers=workspace["headers"]
    )
    assert deleted.status_code == 200

    resolved2 = await client.get(
        f"{workspace['base']}/attachments/resolve",
        params={"filename": "diagram.png"},
        headers=workspace["headers"],
    )
    assert resolved2.status_code == 404
