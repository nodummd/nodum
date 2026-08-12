# Live collaboration (beta)

Per-vault opt-in: **Settings → Live collaboration**. When enabled, every open
note runs a Yjs session; otherwise the editor is completely unchanged.

## Architecture

- **Client** — `y-codemirror.next` binds CodeMirror to a `Y.Text("content")`;
  `y-websocket` connects to `/api/v1/vaults/{vault}/notes/{note}/collab`
  (auth: short-lived access token as a query param; ownership checked before
  the socket is accepted). Remote cursors/selections render with per-user
  colors via the awareness protocol.
- **Server** — one `YRoom` per note (pycrdt). On room creation the current
  note content seeds the doc, so the server is the source of truth. Updates
  fan out across workers through Redis pub/sub (`collab:{vault}/{note}`,
  origin-tagged to avoid echo; Yjs updates are idempotent).
- **Persistence** — a dirty-flag loop writes the doc back through the normal
  `note_service.update_content` pipeline every `COLLAB_PERSIST_INTERVAL_SECONDS`
  (default 3s), plus a final write when the last client leaves. Links, tags,
  aliases, embeddings, and version snapshots all behave exactly as with REST
  saves.

## Conflict story

- **While a session is live, the ydoc is authoritative.** Collab clients
  disable REST autosave; concurrent edits merge via CRDT semantics — no 409s,
  no lost keystrokes.
- **Non-collab writes during a live session** (REST API, import, restore)
  land in the database but are NOT pushed into the running room; the next
  periodic persist from the room overwrites them (last-writer is the room).
  Don't mix modes on the same note simultaneously — the UI never does.
- **Session end**: the final persist snapshots through version history, so
  pre-session content remains recoverable.
- **Offline/disconnect**: `y-websocket` reconnects with backoff and replays
  local pending updates on resync. A client whose access token expired
  (15min) must reopen the note to mint a fresh session.

## Operations

- Feature-gate the whole subsystem with `COLLAB_ENABLED=false` if needed.
- In production the websocket flows through the reverse proxy's `/api/*`
  route (Caddy/nginx proxy websockets transparently) straight to the API.
- Room state is in-memory + Redis pub/sub; no extra storage. Rooms clean up
  when their last client disconnects.
