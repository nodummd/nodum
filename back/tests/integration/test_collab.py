"""Live collaboration — Yjs websocket sync, seeding, persistence, auth."""

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from httpx_ws import WebSocketUpgradeError, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from pycrdt import Doc, Text, create_sync_message, create_update_message, handle_sync_message

from app.core.collab import collab_server
from app.main import app


@pytest.fixture
async def running_collab():
    """ASGITransport skips lifespan — run the collab server for the test."""
    await collab_server.startup()
    yield collab_server
    await collab_server.shutdown()


def _ws_client() -> AsyncClient:
    """Created inside each test — anyio task groups must enter/exit in one task."""
    return AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test")


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"collab-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Collab Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    token = resp.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    vaults = (await client.get("/api/v1/vaults", headers=headers)).json()["data"]
    note = await client.post(
        f"/api/v1/vaults/{vaults[0]['id']}/notes",
        json={"title": "Collab note", "content": "Hello collab."},
        headers=headers,
    )
    return {
        "headers": headers,
        "token": token,
        "vault_id": vaults[0]["id"],
        "note_id": note.json()["data"]["id"],
    }


async def _sync(ws, doc: Doc, want: str, tries: int = 6) -> None:
    """Drive the y-sync handshake until the doc contains ``want``."""
    ytext = doc.get("content", type=Text)
    await ws.send_bytes(create_sync_message(doc))
    for _ in range(tries):
        if str(ytext) == want:
            return
        raw = await asyncio.wait_for(ws.receive_bytes(), timeout=5)
        if raw and raw[0] == 0:
            reply = handle_sync_message(raw[1:], doc)
            if reply is not None:
                await ws.send_bytes(reply)
    assert str(ytext) == want


async def test_collab_seeds_edits_and_persists(client: AsyncClient, workspace: dict, running_collab) -> None:
    url = (
        f"http://test/api/v1/vaults/{workspace['vault_id']}/notes/"
        f"{workspace['note_id']}/collab?token={workspace['token']}"
    )
    doc = Doc()
    ytext = doc.get("content", type=Text)
    updates: list[bytes] = []
    doc.observe(lambda event: updates.append(event.update))

    async with _ws_client() as ws_client, aconnect_ws(url, ws_client) as ws:
        await _sync(ws, doc, "Hello collab.")

        ytext += " Edited live."
        await ws.send_bytes(create_update_message(updates[-1]))
        await asyncio.sleep(0.2)

    # Last client left → room deleted → final persist through the note pipeline
    await asyncio.sleep(0.3)
    resp = await client.get(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}",
        headers=workspace["headers"],
    )
    assert resp.json()["data"]["content"] == "Hello collab. Edited live."


async def test_collab_rejects_invalid_token(workspace: dict, running_collab) -> None:
    url = f"http://test/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}/collab?token=not-a-token"
    async with _ws_client() as ws_client:
        with pytest.raises((WebSocketUpgradeError, Exception)) as exc_info:
            async with aconnect_ws(url, ws_client) as ws:
                await asyncio.wait_for(ws.receive_bytes(), timeout=2)
        assert exc_info.value is not None


async def test_collab_rejects_foreign_note(client: AsyncClient, workspace: dict, running_collab) -> None:
    # Second user must not join the first user's note room
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"intruder-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Intruder",
        },
    )
    client.cookies.clear()
    intruder_token = resp.json()["data"]["access_token"]
    url = (
        f"http://test/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}/collab?token={intruder_token}"
    )
    async with _ws_client() as ws_client:
        with pytest.raises((WebSocketUpgradeError, Exception)):
            async with aconnect_ws(url, ws_client) as ws:
                await asyncio.wait_for(ws.receive_bytes(), timeout=2)
