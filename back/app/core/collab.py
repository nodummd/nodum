"""Live collaboration — Yjs rooms over websockets (S5, Phase C).

One YRoom per note (room name ``{vault_id}/{note_id}``). The room's ydoc holds
the note body in a Y.Text named ``content``:

- **Seeding** — on room creation the current note content is loaded into the
  ydoc before any client syncs. The seed is the SAME bytes on every worker:
  the first worker to open a room stores its seed update in Redis
  (``collab-seed:{room}``, SET NX) and every other worker applies that update
  instead of building its own. Two workers that each did ``ytext += content``
  would hold different CRDT items for the same text, every later update from
  one would reference items the other never saw, and fanout would sit in the
  pending store forever — which is exactly what used to happen under
  ``uvicorn --workers 4``.
- **Late joiners** — a worker that opens a room other workers already hold
  asks them for their state (``collab-sync:{room}``); a holder answers with a
  full-state update on the ordinary update channel. If nobody answers (a
  stale seed left by a crashed worker) the DB row wins.
- **Fanout** — every local update is published to Redis (``collab:{room}``);
  workers subscribe per room and apply remote updates into their local ydoc,
  which rebroadcasts to their websocket clients. Yjs updates are idempotent,
  and a worker-id prefix prevents echo loops.
- **Persistence** — ONE worker per room (a Redis lock, ``collab-persist:{room}``)
  writes the ydoc text through the normal ``note_service.update_content``
  pipeline (links/tags/aliases/versions all apply) every
  ``COLLAB_PERSIST_INTERVAL_SECONDS``, plus a final write when the last client
  leaves. Two writers with converged docs would be harmless; two writers with
  diverging docs (the old bug) flip-flopped the row and lost work.
- **REST saves** — a save outside collab resets any live room to the saved
  text. Exactly one worker applies the reset as a CRDT edit (a per-save lock)
  and the others receive it as an ordinary update; if every holder applied it
  the text would be duplicated once per worker.

The whole feature is gated by ``COLLAB_ENABLED``.
"""

import asyncio
import contextlib
import hashlib
import uuid
from typing import Any
from uuid import UUID

from anyio import Event
from pycrdt import Doc, Text, create_awareness_message
from pycrdt.websocket import WebsocketServer, YRoom

from app.core.logging import get_logger

logger = get_logger("collab")

# Distinguishes this worker's pub/sub messages from other workers'
WORKER_ID = uuid.uuid4().hex.encode()  # 32 bytes

SEED_TTL_SECONDS = 600  # refreshed while any worker holds the room
PERSIST_LOCK_SECONDS = 15  # refreshed by the owner every persist tick
SYNC_WAIT_SECONDS = 0.6  # how long a late joiner waits for a holder's state


def room_name(vault_id: UUID, note_id: UUID) -> str:
    return f"{vault_id}/{note_id}"


class _RoomState:
    __slots__ = (
        "aw_subscription",
        "dirty",
        "note_id",
        "owner_id",
        "pubsub_task",
        "subscribed",
        "subscription",
        "synced",
        "vault_id",
    )

    def __init__(self, vault_id: UUID, note_id: UUID, owner_id: UUID) -> None:
        self.vault_id = vault_id
        self.note_id = note_id
        self.owner_id = owner_id
        self.dirty = False
        self.pubsub_task: asyncio.Task[None] | None = None
        self.subscription: Any = None
        self.aw_subscription: str | None = None
        self.subscribed = asyncio.Event()  # the pubsub is listening
        self.synced = asyncio.Event()  # a holder's state (or any update) arrived


def _room_exception_handler(exception: Exception, _log: Any) -> bool:
    """Room/client errors must never kill the shared server task group.

    Client disconnects surface as exceptions from the per-client task group;
    swallow everything here (logged) so one dropped socket can't break every
    future room (pycrdt re-raises unhandled exceptions into the main group).
    """
    logger.info("collab_room_exception", error=repr(exception))
    return True


class CollabServer(WebsocketServer):
    """WebsocketServer with note seeding, Redis fanout, and DB persistence."""

    def __init__(self, worker_id: bytes | None = None) -> None:
        super().__init__(auto_clean_rooms=True, exception_handler=_room_exception_handler, log=None)
        self.worker_id = worker_id or WORKER_ID
        self.states: dict[str, _RoomState] = {}
        self._applying_remote: set[str] = set()
        self._closing: dict[str, asyncio.Event] = {}
        self._persist_task: asyncio.Task[None] | None = None
        self._server_task: asyncio.Task[None] | None = None

    # ── Room lifecycle ───────────────────────────────────────────────────────

    async def get_room(self, name: str) -> YRoom:
        # A client joining while the room's last client is leaving must not be
        # handed the room being torn down — its whole session would go
        # unpersisted. Wait for the teardown, then open a fresh one.
        closing = self._closing.get(name)
        if closing is not None:
            await closing.wait()
        created = name not in self.rooms
        room = await super().get_room(name)
        if created:
            try:
                await self._init_room(name, room)
            except Exception:
                # Never hand out a half-initialized room
                await super().delete_room(name=name)
                raise
        return room

    async def _init_room(self, name: str, room: YRoom) -> None:
        vault_id, note_id = (UUID(part) for part in name.split("/"))

        from sqlalchemy import select

        from app.core.db import async_session_factory
        from app.models.vaults import Note, Vault

        async with async_session_factory() as db:
            row = (
                await db.execute(
                    select(Note.content, Vault.user_id)
                    .join(Vault, Vault.id == Note.vault_id)
                    .where(Note.id == note_id, Note.vault_id == vault_id)
                )
            ).first()
        if row is None:
            raise RuntimeError(f"collab room for missing note {name}")
        content, owner_id = row

        state = _RoomState(vault_id, note_id, owner_id)
        self.states[name] = state

        # Local update observer: mark dirty + publish to other workers
        def on_update(event: Any) -> None:
            state.dirty = True
            if name not in self._applying_remote:
                update: bytes = event.update
                asyncio.get_running_loop().create_task(self._publish(name, update))

        # Presence too: a client's awareness (cursor, name, colour) reaches the
        # room's local clients through pycrdt, but other workers' clients only
        # through us. The room applies each client message to its own
        # Awareness with origin=room; anything we receive from other workers is
        # applied with origin=self, so it is never re-published.
        def on_awareness(topic: str, changes: tuple[dict[str, Any], Any]) -> None:
            if topic != "update" or changes[1] is not room:
                return
            ids = [cid for ids in changes[0].values() for cid in ids]
            if ids:
                update = room.awareness.encode_awareness_update(ids)
                asyncio.get_running_loop().create_task(self._publish_awareness(name, update))

        others = await self._seed(name, room, content or "")
        state.subscription = room.ydoc.observe(on_update)
        state.aw_subscription = room.awareness.observe(on_awareness)
        state.pubsub_task = asyncio.create_task(self._subscribe(name, room, state))
        if others:
            await self._catch_up(name, room, state, content or "")
        logger.info("collab_room_opened", room=name, other_holders=others)

    # ── Deterministic seed + late-joiner sync ───────────────────────────────

    async def _seed(self, name: str, room: YRoom, content: str) -> int:
        """Seed the room with the SAME update every worker uses. Returns how
        many other workers hold the room (0 = this seed is fresh from the DB)."""
        seed_doc = Doc()
        if content:
            seed_doc.get("content", type=Text).insert(0, content)
        mine = seed_doc.get_update()
        chosen = mine
        others = 0
        try:
            from app.core.redis import redis_binary

            key = f"collab-seed:{name}"
            if not await redis_binary.set(key, mine, nx=True, ex=SEED_TTL_SECONDS):
                stored = await redis_binary.get(key)
                if stored:
                    chosen = stored
            holders = await redis_binary.incr(f"collab-holders:{name}")
            await redis_binary.expire(f"collab-holders:{name}", SEED_TTL_SECONDS)
            others = max(int(holders) - 1, 0)
        except Exception as e:  # Redis down: fanout is dead anyway; seed locally
            logger.warning("collab_seed_redis_failed", room=name, error=str(e))
        self._applying_remote.add(name)  # the seed is not a local edit to publish
        try:
            room.ydoc.apply_update(chosen)
        finally:
            self._applying_remote.discard(name)
        return others

    async def _catch_up(self, name: str, room: YRoom, state: _RoomState, db_content: str) -> None:
        """Ask the workers already holding this room for their state. If none
        answers — a stale seed left behind by a crashed worker — the DB row is
        the truth and replaces the seed."""
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(state.subscribed.wait(), timeout=2)
        try:
            from app.core.redis import redis_binary

            await redis_binary.publish(f"collab-sync:{name}", self.worker_id + b"REQ")
        except Exception as e:
            logger.warning("collab_sync_request_failed", room=name, error=str(e))
        try:
            await asyncio.wait_for(state.synced.wait(), timeout=SYNC_WAIT_SECONDS)
        except TimeoutError:
            if str(room.ydoc.get("content", type=Text)) != db_content:
                self._reset_local(name, room, db_content)
                logger.info("collab_seed_stale_reset", room=name)

    async def _answer_sync(self, name: str, room: YRoom) -> None:
        """A late joiner asked: hand it everything (idempotent to apply)."""
        await self._publish(name, room.ydoc.get_update())

    async def delete_room(self, *, name: str | None = None, room: YRoom | None = None) -> None:
        if name is None and room is not None:
            name = self.get_room_name(room)
        assert name is not None
        closing = asyncio.Event()
        self._closing[name] = closing
        try:
            state = self.states.pop(name, None)
            if state is not None:
                target_room = room if room is not None else self.rooms.get(name)
                if state.aw_subscription is not None and target_room is not None:
                    with contextlib.suppress(Exception):
                        target_room.awareness.unobserve(state.aw_subscription)
                if state.pubsub_task is not None:
                    state.pubsub_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await state.pubsub_task
                target = room if room is not None else self.rooms.get(name)
                if state.dirty and target is not None:
                    await self._persist(name, state, target, final=True)
                await self._release_holder(name)
            await super().delete_room(name=name)
            logger.info("collab_room_closed", room=name)
        finally:
            self._closing.pop(name, None)
            closing.set()

    async def _release_holder(self, name: str) -> None:
        try:
            from app.core.redis import redis_binary

            left = await redis_binary.decr(f"collab-holders:{name}")
            if int(left) <= 0:
                # Nobody holds the room any more: the next opener seeds from
                # the DB, which has the final persisted text.
                await redis_binary.delete(f"collab-holders:{name}", f"collab-seed:{name}")
            await self._drop_persist_lock(name)
        except Exception as e:
            logger.warning("collab_release_failed", room=name, error=str(e))

    # ── Redis fanout ─────────────────────────────────────────────────────────

    async def _publish(self, name: str, update: bytes) -> None:
        try:
            from app.core.redis import redis_binary

            await redis_binary.publish(f"collab:{name}", self.worker_id + update)
        except Exception as e:
            logger.warning("collab_publish_failed", room=name, error=str(e))

    async def _publish_awareness(self, name: str, update: bytes) -> None:
        try:
            from app.core.redis import redis_binary

            await redis_binary.publish(f"collab-aw:{name}", self.worker_id + update)
        except Exception as e:
            logger.warning("collab_awareness_publish_failed", room=name, error=str(e))

    async def _apply_remote_awareness(self, room: YRoom, update: bytes) -> None:
        """Another worker's clients' presence: into our Awareness (origin=self,
        so it is not re-published) and out to our websocket clients."""
        room.awareness.apply_awareness_update(update, self)
        message = create_awareness_message(update)
        for client in list(room.clients):
            with contextlib.suppress(Exception):
                await client.send(message)

    async def _subscribe(self, name: str, room: YRoom, state: _RoomState) -> None:
        # redis_binary, NOT redis_control: Yjs updates are raw CRDT bytes and a
        # decode_responses=True client raises on the first non-UTF-8 byte,
        # taking the whole subscription down with it.
        try:
            from app.core.redis import redis_binary

            reset_channel = f"collab-reset:{name}".encode()
            sync_channel = f"collab-sync:{name}".encode()
            aw_channel = f"collab-aw:{name}".encode()
            pubsub = redis_binary.pubsub(ignore_subscribe_messages=True)
            # The pubsub holds a pooled connection for as long as it lives, and
            # delete_room only CANCELS this task. redis-py's PubSub.__del__ does
            # not return the connection, so without this finally the pool
            # (max_connections=20) is exhausted after ~20 note opens — every
            # later subscribe AND publish then raises "Too many connections",
            # both are swallowed as warnings, and the worker keeps serving rooms
            # with fanout silently dead and deaf to collab-reset. That is the
            # "REST save reverts the note" bug coming back, permanently, until
            # the process restarts.
            try:
                await pubsub.subscribe(
                    f"collab:{name}", f"collab-reset:{name}", f"collab-sync:{name}", f"collab-aw:{name}"
                )
                state.subscribed.set()
                async for message in pubsub.listen():
                    data = message.get("data")
                    if not isinstance(data, bytes) or data[:32] == self.worker_id:
                        continue
                    channel = message.get("channel")
                    if channel == aw_channel:
                        await self._apply_remote_awareness(room, data[32:])
                        continue
                    if channel == sync_channel:
                        if data[32:] == b"REQ":
                            await self._answer_sync(name, room)
                        continue
                    if channel == reset_channel:
                        # A REST save landed on another worker — adopt its text
                        # or this room would rebroadcast (and re-persist) the
                        # old body. One worker applies it; the rest receive it.
                        await self._maybe_apply_reset(name, room, data[32:].decode("utf-8"))
                        continue
                    self._applying_remote.add(name)
                    try:
                        room.ydoc.apply_update(data[32:])
                        state.synced.set()
                    except Exception as e:  # one bad update must not kill fanout
                        logger.warning("collab_apply_failed", room=name, error=str(e))
                    finally:
                        self._applying_remote.discard(name)
            finally:
                # Runs on CancelledError too, which is the normal exit path.
                await pubsub.aclose()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("collab_subscribe_failed", room=name, error=str(e))

    # ── REST ↔ room reconciliation ───────────────────────────────────────────

    def _reset_local(self, name: str, room: YRoom, content: str) -> None:
        """Force this worker's room text to ``content``.

        Replaces rather than merges: the DB row is authoritative at this point,
        and a CRDT merge of "the old body" with "the new body" produces neither.
        """
        ytext = room.ydoc.get("content", type=Text)
        if str(ytext) == content:
            return
        with room.ydoc.transaction():
            ytext.clear()
            if content:
                ytext += content
        # The write is a legitimate local edit — it must reach this room's own
        # websocket clients — but it is already in the DB, so don't re-persist.
        state = self.states.get(name)
        if state is not None:
            state.dirty = False
        logger.info("collab_room_reset", room=name)

    async def _maybe_apply_reset(self, name: str, room: YRoom, content: str) -> None:
        """Apply a REST save to this worker's room — but only if no other worker
        already did for this exact save. Every holder applying it as its own
        CRDT edit would leave the text once per worker after fanout."""
        if str(room.ydoc.get("content", type=Text)) == content:
            return
        try:
            from app.core.redis import redis_binary

            digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:32]
            won = await redis_binary.set(f"collab-resetlock:{name}:{digest}", self.worker_id, nx=True, ex=10)
        except Exception as e:
            logger.warning("collab_reset_lock_failed", room=name, error=str(e))
            won = True  # no Redis → no other worker can hear this anyway
        if won:
            self._reset_local(name, room, content)

    async def sync_room(self, vault_id: UUID, note_id: UUID, content: str) -> None:
        """Publish a REST save into any live room for this note.

        Without this a room seeded before the save keeps serving (and eventually
        persisting) the pre-save body: the client sees its note revert.
        """
        name = room_name(vault_id, note_id)
        room = self.rooms.get(name)
        if room is not None:
            await self._maybe_apply_reset(name, room, content)
        # The worker that handled the REST call may not be the one holding the
        # room — announce it on the reset channel too (the lock above makes
        # sure exactly one holder turns it into a CRDT edit).
        try:
            from app.core.redis import redis_binary

            await redis_binary.publish(f"collab-reset:{name}", self.worker_id + content.encode("utf-8"))
        except Exception as e:
            logger.warning("collab_reset_publish_failed", room=name, error=str(e))

    # ── Persistence ──────────────────────────────────────────────────────────

    async def _own_persist(self, name: str, *, final: bool = False) -> bool:
        """True if this worker may write the note: it holds (or can take) the
        room's persist lock. With converged docs a second writer would be
        merely redundant; with diverging docs (the old bug) it flip-flopped the
        row. One owner keeps the write path boring."""
        try:
            from app.core.redis import redis_binary

            key = f"collab-persist:{name}"
            if await redis_binary.set(key, self.worker_id, nx=True, ex=PERSIST_LOCK_SECONDS):
                return True
            holder = await redis_binary.get(key)
            if holder == self.worker_id:
                await redis_binary.expire(key, PERSIST_LOCK_SECONDS)
                return True
            return False
        except Exception as e:
            logger.warning("collab_persist_lock_failed", room=name, error=str(e))
            return True  # Redis down: better a redundant write than none

    async def _drop_persist_lock(self, name: str) -> None:
        from app.core.redis import redis_binary

        key = f"collab-persist:{name}"
        if await redis_binary.get(key) == self.worker_id:
            await redis_binary.delete(key)

    async def _persist(self, name: str, state: _RoomState, room: YRoom, *, final: bool = False) -> None:
        if not await self._own_persist(name, final=final):
            return  # another worker owns the write; it has our updates via fanout
        state.dirty = False
        content = str(room.ydoc.get("content", type=Text))
        try:
            from app.core.db import async_session_factory
            from app.services import note_service

            async with async_session_factory() as db:
                result = await note_service.update_content(
                    db, state.vault_id, state.owner_id, state.note_id, content=content, sync_collab=False
                )
            if not result.success:
                logger.warning("collab_persist_rejected", room=name, error=result.message)
        except Exception as e:
            state.dirty = True  # retry next tick
            logger.warning("collab_persist_failed", room=name, error=str(e))

    async def _persist_loop(self) -> None:
        from app.settings import get_settings

        interval = get_settings().COLLAB_PERSIST_INTERVAL_SECONDS
        while True:
            await asyncio.sleep(interval)
            for name, state in list(self.states.items()):
                room = self.rooms.get(name)
                if room is None:
                    continue
                await self._keep_alive(name)
                if state.dirty:
                    await self._persist(name, state, room)

    async def _keep_alive(self, name: str) -> None:
        """The seed and holder count must outlive every room that uses them."""
        try:
            from app.core.redis import redis_binary

            await redis_binary.expire(f"collab-seed:{name}", SEED_TTL_SECONDS)
            await redis_binary.expire(f"collab-holders:{name}", SEED_TTL_SECONDS)
        except Exception as e:
            logger.warning("collab_keepalive_failed", room=name, error=str(e))

    # ── App lifecycle ────────────────────────────────────────────────────────

    async def startup(self) -> None:
        # WebsocketServer.stop() latches its stopped/started events and never
        # clears them, so a second startup() would return a server whose task
        # group is already unwinding — every room then fails to start with
        # "task group is not active". Reset them so the lifespan is repeatable
        # (uvicorn --reload, and any test that starts the server twice).
        self._stopped = Event()
        self._started = None
        self._server_task = asyncio.create_task(self.start())
        await self.started.wait()
        self._persist_task = asyncio.create_task(self._persist_loop())

    async def shutdown(self) -> None:
        if self._persist_task is not None:
            self._persist_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._persist_task
        # Final persist + cleanup for any rooms still open
        for name in list(self.states.keys()):
            with contextlib.suppress(Exception):
                await self.delete_room(name=name)
        await self.stop()
        # start()'s task group unwinds inside its own task — wait, don't cancel
        if self._server_task is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._server_task, timeout=5)
            self._server_task = None


collab_server = CollabServer()


def make_doc() -> Doc:  # re-exported for tests
    return Doc()
