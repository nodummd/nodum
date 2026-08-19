# Live collaboration (beta)

Per-vault opt-in: **Settings → Live collaboration**. When enabled, every open
note runs a Yjs session; otherwise the editor is completely unchanged.

## Architecture

- **Client** — `y-codemirror.next` binds CodeMirror to a `Y.Text("content")`;
  `y-websocket` connects to `/api/v1/vaults/{vault}/notes/{note}/collab`
  (auth: short-lived access token as a query param; ownership checked before
  the socket is accepted). Remote cursors/selections render with per-user
  colors via the awareness protocol.
- **Server** — one `YRoom` per note (pycrdt) **per worker**. Production runs
  `uvicorn --workers 4`, so the same note can be held by several workers at
  once; everything below exists to make that invisible:
  - *One seed for everyone.* The first worker to open a room builds the seed
    update from the note's content and stores it in Redis (`collab-seed:{room}`,
    SET NX); every other worker applies those exact bytes. (Each worker seeding
    itself — the original design — gave every worker different CRDT items for
    the same text, so cross-worker updates sat in the pending store forever:
    two people on different workers never saw each other and the persist loops
    flip-flopped the row.)
  - *Late joiners catch up.* A worker opening a room others already hold asks
    them for their state (`collab-sync:{room}`) and gets a full-state update
    back on the ordinary channel. If nobody answers — a crashed worker's stale
    seed — the DB row wins.
  - *Fanout.* Updates fan out through Redis pub/sub (`collab:{room}`, worker-id
    tagged to avoid echo; Yjs updates are idempotent).
  - *A joining client never gets a room being torn down* — it waits for the
    teardown and opens a fresh one.
- **Persistence** — **one worker per room** (Redis lock `collab-persist:{room}`,
  refreshed each tick, released when the room closes) writes the doc back
  through the normal `note_service.update_content` pipeline every
  `COLLAB_PERSIST_INTERVAL_SECONDS` (default 3s), plus a final write when the
  last client leaves. Links, tags, aliases, embeddings, and version snapshots
  all behave exactly as with REST saves.
- **Undo is local.** Peers' edits are kept out of CodeMirror's history, so ⌘Z
  undoes what you typed, never what they typed.

## Conflict story

- **While a session is live, the ydoc is authoritative.** Collab clients
  disable REST autosave; concurrent edits merge via CRDT semantics — no 409s,
  no lost keystrokes.
- **Non-collab writes during a live session** (REST API, import, restore)
  are pushed into every live room for the note (`collab-reset:{room}`):
  exactly one worker turns the saved text into a CRDT edit (a per-save lock)
  and the rest receive it as an ordinary update, so the text is replaced once,
  not once per worker. Don't mix modes on the same note simultaneously — the
  UI never does.
- **Session end**: the final persist snapshots through version history, so
  pre-session content remains recoverable.
- **Offline/disconnect**: when the socket drops after a successful sync the
  client deliberately REBUILDS its session with a fresh doc instead of
  re-syncing the old one — a restarted server re-seeds rooms with new CRDT
  operation ids, and merging the stale doc against that would duplicate the
  whole note. Unsent keystrokes from the moment of disconnect are lost; the
  periodic server persist (3s) keeps that window small. A client whose
  access token expired (15min) must reopen the note for a fresh session.

## Operations

- Feature-gate the whole subsystem with `COLLAB_ENABLED=false` if needed.
- In production the websocket flows through the reverse proxy's `/api/*`
  route (Caddy/nginx proxy websockets transparently) straight to the API.
- Room state is in-memory + Redis (pub/sub, the shared seed, the holder
  count and the persist lock, all with TTLs); no extra storage. Rooms clean up
  when their last client disconnects; the seed goes when the last worker does.
- Tests: `back/tests/integration/test_collab.py` runs a second `CollabServer`
  in-process as a stand-in worker and proves convergence, late-join catch-up,
  stale-seed recovery, single-apply of REST saves and the join/teardown race.
