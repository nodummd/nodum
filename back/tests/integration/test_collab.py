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


async def test_rest_save_is_not_resurrected_by_a_live_room(
    client: AsyncClient, workspace: dict, running_collab
) -> None:
    """A REST save must win over the body a live room was seeded with.

    The room loads the note once, at creation. Anything that writes through the
    REST API afterwards — another tab, the clipper, an import — leaves the room
    holding the OLD text, which it then serves to every client that connects and
    eventually persists back over the save. The note silently reverts.
    """
    url = (
        f"http://test/api/v1/vaults/{workspace['vault_id']}/notes/"
        f"{workspace['note_id']}/collab?token={workspace['token']}"
    )
    doc = Doc()
    ytext = doc.get("content", type=Text)

    async with _ws_client() as ws_client, aconnect_ws(url, ws_client) as ws:
        await _sync(ws, doc, "Hello collab.")

        # A REST save lands while the room is open and holding the old body.
        saved = await client.put(
            f"/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}/content",
            json={"content": "Rewritten over REST."},
            headers=workspace["headers"],
        )
        assert saved.status_code == 200, saved.text
        await asyncio.sleep(0.3)

        # The room adopted it, and pushed it down to the connected client.
        room = collab_server.rooms[f"{workspace['vault_id']}/{workspace['note_id']}"]
        assert str(room.ydoc.get("content", type=Text)) == "Rewritten over REST."
        await _sync(ws, doc, "Rewritten over REST.")
        assert str(ytext) == "Rewritten over REST."

    # And closing the room does not write the stale body back.
    await asyncio.sleep(0.3)
    resp = await client.get(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}",
        headers=workspace["headers"],
    )
    assert resp.json()["data"]["content"] == "Rewritten over REST."


async def test_room_churn_does_not_leak_redis_connections(workspace: dict, running_collab) -> None:
    """Opening and closing many rooms must not exhaust the Redis pool.

    Each room holds a pubsub, and delete_room only CANCELS its task. redis-py's
    PubSub.__del__ does not return the pooled connection, so without an explicit
    aclose the pool (max_connections=20) is spent after ~20 note opens. Every
    later subscribe AND publish then fails, both are swallowed as warnings, and
    the worker serves rooms with fanout dead and deaf to collab-reset — which is
    the "REST save reverts the note" bug returning permanently.

    Twenty-five cycles is just twenty-five note switches.
    """
    from uuid import UUID

    from app.core.collab import collab_server, room_name
    from app.core.redis import redis_binary

    name = room_name(UUID(workspace["vault_id"]), UUID(workspace["note_id"]))
    pool = redis_binary.connection_pool
    baseline = len(pool._in_use_connections)

    for _ in range(25):
        await collab_server.get_room(name)
        # Let _subscribe actually reach pubsub.subscribe() and take a pooled
        # connection. Without this the loop cancels the task before it ever
        # subscribes, nothing is borrowed, and the test proves nothing.
        await asyncio.sleep(0.02)
        await collab_server.delete_room(name=name)

    assert len(pool._in_use_connections) - baseline <= 1, "pubsub connections are not being returned to the pool"
    # And the plane is still usable, which is what the leak actually broke.
    await redis_binary.publish(f"collab:{name}", b"\x00" * 33)


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


# ── Multi-worker ─────────────────────────────────────────────────────────────


async def _text(server, name: str) -> str:
    return str(server.rooms[name].ydoc.get("content", type=Text))


async def _eventually(fn, want, *, timeout: float = 3.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        got = await fn()
        if got == want:
            return
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError(f"expected {want!r}, got {got!r}")
        await asyncio.sleep(0.05)


@pytest.fixture
async def second_worker():
    """A second CollabServer in this process stands in for another uvicorn
    worker: its own worker id, its own rooms and ydocs, the same Redis."""
    from app.core.collab import CollabServer

    other = CollabServer(worker_id=b"B" * 32)
    await other.startup()
    yield other
    await other.shutdown()


async def test_two_workers_converge_on_a_non_empty_note(
    client: AsyncClient, workspace: dict, running_collab, second_worker
) -> None:
    """The bug: each worker seeded its own CRDT items for the same text, so an
    update from one referenced items the other never had and sat in the pending
    store forever — two people on different workers never saw each other and
    the persist loops flip-flopped the row. With one shared seed they converge."""
    from uuid import UUID

    from app.core.collab import room_name

    name = room_name(UUID(workspace["vault_id"]), UUID(workspace["note_id"]))
    a = running_collab
    b = second_worker
    await a.get_room(name)
    await b.get_room(name)
    assert await _text(a, name) == await _text(b, name) == "Hello collab."
    # Both must have the SAME items, not merely the same string: an edit made
    # on A must land on B, and vice versa.
    a.rooms[name].ydoc.get("content", type=Text).insert(0, "A says: ")
    await _eventually(lambda: _text(b, name), "A says: Hello collab.")
    b.rooms[name].ydoc.get("content", type=Text).insert(len("A says: Hello collab."), " B agrees.")
    await _eventually(lambda: _text(a, name), "A says: Hello collab. B agrees.")

    # One persist owner: whoever holds the lock writes; the other skips and
    # keeps its dirty flag. Either way the row ends up with the merged text.
    owners = [await a._own_persist(name), await b._own_persist(name)]
    assert owners.count(True) == 1, owners
    await a._persist(name, a.states[name], a.rooms[name])
    await b._persist(name, b.states[name], b.rooms[name])
    note = (
        await client.get(
            f"/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}", headers=workspace["headers"]
        )
    ).json()["data"]
    assert note["content"] == "A says: Hello collab. B agrees."

    await a.delete_room(name=name)
    await b.delete_room(name=name)


async def test_late_joining_worker_catches_up(workspace: dict, running_collab, second_worker) -> None:
    """B opens the room after A has already taken edits: B must receive A's
    state, not just the original seed — otherwise B's clients would see an old
    body and B could persist it over A's work."""
    from uuid import UUID

    from app.core.collab import room_name

    name = room_name(UUID(workspace["vault_id"]), UUID(workspace["note_id"]))
    a, b = running_collab, second_worker
    await a.get_room(name)
    a.rooms[name].ydoc.get("content", type=Text).insert(0, "Edited before B arrived. ")
    await asyncio.sleep(0.05)
    await b.get_room(name)
    await _eventually(lambda: _text(b, name), "Edited before B arrived. Hello collab.")
    # And fanout works both ways from here on.
    b.rooms[name].ydoc.get("content", type=Text).insert(0, "[B] ")
    await _eventually(lambda: _text(a, name), "[B] Edited before B arrived. Hello collab.")
    await a.delete_room(name=name)
    await b.delete_room(name=name)


async def test_stale_seed_from_a_crashed_worker_yields_to_the_database(
    client: AsyncClient, workspace: dict, running_collab
) -> None:
    """A worker died holding the room: its seed and holder count linger in
    Redis. The next opener must end up with the DB text, not the stale seed."""
    from uuid import UUID

    from app.core.collab import room_name
    from app.core.redis import redis_binary

    name = room_name(UUID(workspace["vault_id"]), UUID(workspace["note_id"]))
    a = running_collab
    await a.get_room(name)
    stale = await redis_binary.get(f"collab-seed:{name}")
    await a.delete_room(name=name)  # holder count → 0, seed gone
    # Simulate the crash: the stale seed is back, a phantom holder is counted,
    # and meanwhile the note was saved over REST with new text.
    await redis_binary.set(f"collab-seed:{name}", stale, ex=600)
    await redis_binary.set(f"collab-holders:{name}", 1, ex=600)
    saved = await client.put(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}/content",
        json={"content": "Saved while nobody was home."},
        headers=workspace["headers"],
    )
    assert saved.status_code == 200
    await a.get_room(name)
    assert await _text(a, name) == "Saved while nobody was home."
    await a.delete_room(name=name)
    await redis_binary.delete(f"collab-holders:{name}", f"collab-seed:{name}")


async def test_rest_save_with_two_workers_is_applied_once(
    client: AsyncClient, workspace: dict, running_collab, second_worker
) -> None:
    """Both workers hold the room and a REST save lands: exactly one turns it
    into a CRDT edit and the other receives that edit — applying it on both
    would leave the text twice."""
    from uuid import UUID

    from app.core.collab import room_name

    name = room_name(UUID(workspace["vault_id"]), UUID(workspace["note_id"]))
    a, b = running_collab, second_worker
    await a.get_room(name)
    await b.get_room(name)
    saved = await client.put(
        f"/api/v1/vaults/{workspace['vault_id']}/notes/{workspace['note_id']}/content",
        json={"content": "Saved over REST."},
        headers=workspace["headers"],
    )
    assert saved.status_code == 200
    await _eventually(lambda: _text(a, name), "Saved over REST.")
    await _eventually(lambda: _text(b, name), "Saved over REST.")
    await asyncio.sleep(0.3)  # any duplicate would have arrived by now
    assert await _text(a, name) == await _text(b, name) == "Saved over REST."
    await a.delete_room(name=name)
    await b.delete_room(name=name)


async def test_join_during_teardown_gets_a_fresh_room(workspace: dict, running_collab) -> None:
    """A client joining while the last one leaves must not be handed the room
    being torn down (its session would never be persisted)."""
    from uuid import UUID

    from app.core.collab import room_name

    name = room_name(UUID(workspace["vault_id"]), UUID(workspace["note_id"]))
    a = running_collab
    first = await a.get_room(name)
    a.rooms[name].ydoc.get("content", type=Text).insert(0, "dirty ")
    closing = asyncio.create_task(a.delete_room(name=name))
    await asyncio.sleep(0)  # let delete_room register the closing gate
    second = await a.get_room(name)
    await closing
    assert second is not first, "joined the room that was being deleted"
    assert name in a.states and name in a.rooms
    await a.delete_room(name=name)
