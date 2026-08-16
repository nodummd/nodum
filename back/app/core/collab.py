"""Live collaboration — Yjs rooms over websockets (S5, Phase C).

One YRoom per note (room name ``{vault_id}/{note_id}``). The room's ydoc holds
the note body in a Y.Text named ``content``:

- **Seeding** — on room creation the current note content is loaded into the
  ydoc before any client syncs, so the server is the single source of truth.
- **Fanout** — every local update is published to Redis (``collab:{room}``);
  workers subscribe per room and apply remote updates into their local ydoc,
  which rebroadcasts to their websocket clients. Yjs updates are idempotent,
  and an origin prefix prevents echo loops.
- **Persistence** — a dirty-flag loop writes the ydoc text through the normal
  ``note_service.update_content`` pipeline (links/tags/aliases/versions all
  apply) every ``COLLAB_PERSIST_INTERVAL_SECONDS``, plus a final write when
  the last client leaves and the room is deleted.

The whole feature is gated by ``COLLAB_ENABLED``.
"""

import asyncio
import contextlib
import uuid
from typing import Any
from uuid import UUID

from anyio import Event
from pycrdt import Doc, Text
from pycrdt.websocket import WebsocketServer, YRoom

from app.core.logging import get_logger

logger = get_logger("collab")

# Distinguishes this worker's pub/sub messages from other workers'
WORKER_ID = uuid.uuid4().hex.encode()  # 32 bytes


def room_name(vault_id: UUID, note_id: UUID) -> str:
    return f"{vault_id}/{note_id}"


class _RoomState:
    __slots__ = ("dirty", "note_id", "owner_id", "pubsub_task", "subscription", "vault_id")

    def __init__(self, vault_id: UUID, note_id: UUID, owner_id: UUID) -> None:
        self.vault_id = vault_id
        self.note_id = note_id
        self.owner_id = owner_id
        self.dirty = False
        self.pubsub_task: asyncio.Task[None] | None = None
        self.subscription: Any = None


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

    def __init__(self) -> None:
        super().__init__(auto_clean_rooms=True, exception_handler=_room_exception_handler, log=None)
        self.states: dict[str, _RoomState] = {}
        self._applying_remote: set[str] = set()
        self._persist_task: asyncio.Task[None] | None = None
        self._server_task: asyncio.Task[None] | None = None

    # ── Room lifecycle ───────────────────────────────────────────────────────

    async def get_room(self, name: str) -> YRoom:
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

        ytext = room.ydoc.get("content", type=Text)
        if content and str(ytext) == "":
            ytext += content

        state = _RoomState(vault_id, note_id, owner_id)
        self.states[name] = state

        # Local update observer: mark dirty + publish to other workers
        def on_update(event: Any) -> None:
            state.dirty = True
            if name not in self._applying_remote:
                update: bytes = event.update
                asyncio.get_running_loop().create_task(self._publish(name, update))

        state.subscription = room.ydoc.observe(on_update)
        state.pubsub_task = asyncio.create_task(self._subscribe(name, room))
        logger.info("collab_room_opened", room=name)

    async def delete_room(self, *, name: str | None = None, room: YRoom | None = None) -> None:
        if name is None and room is not None:
            name = self.get_room_name(room)
        assert name is not None
        state = self.states.pop(name, None)
        if state is not None:
            if state.pubsub_task is not None:
                state.pubsub_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await state.pubsub_task
            target = room if room is not None else self.rooms.get(name)
            if state.dirty and target is not None:
                await self._persist(name, state, target)
        await super().delete_room(name=name)
        logger.info("collab_room_closed", room=name)

    # ── Redis fanout ─────────────────────────────────────────────────────────

    async def _publish(self, name: str, update: bytes) -> None:
        try:
            from app.core.redis import redis_binary

            await redis_binary.publish(f"collab:{name}", WORKER_ID + update)
        except Exception as e:
            logger.warning("collab_publish_failed", room=name, error=str(e))

    async def _subscribe(self, name: str, room: YRoom) -> None:
        # redis_binary, NOT redis_control: Yjs updates are raw CRDT bytes and a
        # decode_responses=True client raises on the first non-UTF-8 byte,
        # taking the whole subscription down with it.
        try:
            from app.core.redis import redis_binary

            reset_channel = f"collab-reset:{name}".encode()
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
                await pubsub.subscribe(f"collab:{name}", f"collab-reset:{name}")
                async for message in pubsub.listen():
                    data = message.get("data")
                    if not isinstance(data, bytes) or data[:32] == WORKER_ID:
                        continue
                    if message.get("channel") == reset_channel:
                        # A REST save landed on another worker — adopt its text
                        # or this room would rebroadcast (and re-persist) the
                        # old body.
                        self._reset_local(name, room, data[32:].decode("utf-8"))
                        continue
                    self._applying_remote.add(name)
                    try:
                        room.ydoc.apply_update(data[32:])
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

    async def sync_room(self, vault_id: UUID, note_id: UUID, content: str) -> None:
        """Publish a REST save into any live room for this note.

        Without this a room seeded before the save keeps serving (and eventually
        persisting) the pre-save body: the client sees its note revert.
        """
        name = room_name(vault_id, note_id)
        room = self.rooms.get(name)
        if room is not None:
            self._reset_local(name, room, content)
        # The local reset already fans out as an ordinary ydoc update, but the
        # worker that handled the REST call may not be the one holding the
        # room — so announce it on the reset channel too.
        try:
            from app.core.redis import redis_binary

            await redis_binary.publish(f"collab-reset:{name}", WORKER_ID + content.encode("utf-8"))
        except Exception as e:
            logger.warning("collab_reset_publish_failed", room=name, error=str(e))

    # ── Persistence ──────────────────────────────────────────────────────────

    async def _persist(self, name: str, state: _RoomState, room: YRoom) -> None:
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
                if room is not None and state.dirty:
                    await self._persist(name, state, room)

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
