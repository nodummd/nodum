# Goal — close the backlog and ship v3.3.0 (2026-08-19)

Everything the previous goal docs left open, plus the release. Branch chain
from `dev` (`c445f21`), each merged `--no-ff`, each gated by `make verify`,
backend integration and the full Playwright suite; every fix proven by a test
that fails without it; each step reviewed adversarially before the release.

## Items

| # | Item | Source | Status |
|---|------|--------|--------|
| 1 | **P0-2 collab under `--workers 4`** — deterministic shared seed across workers, late-joiner state sync, single persist owner, join/delete race (R2/R3); remote edits must not enter the local undo stack; `docs/collab.md` honest | editor-fixes P0-2, P1-3 (4) | ✅ `feature/1.collab-fanout` |
| 2 | **P1-3 undo/redo** — Compartment reconfiguration (no remount on mode/pref change), per-(pane,note) history snapshots with an LRU, Windows redo chord, ⌘U decision | editor-fixes P1-3 | ✅ `feature/2.undo-history` |
| 3 | Explorer click opens in the **current** tab (Obsidian; ⌘-click = new tab); `[[Note#Heading]]` scrolls to the heading | review pass 2/3 doc-vs-code | ✅ `feature/3.explorer-tab-heading` |
| 4 | **Streaming AI replies** (SSE token stream into the chat pane) | vaults-ai goal | ✅ `feature/4.ai-streaming` |
| 5 | **Per-vault AI keys** (a vault may override the account key/model) | vaults-ai goal | ✅ `feature/5.ai-vault-keys` |
| 6 | **Docs full-text search** over article bodies | onboarding-docs-mcp goal | ✅ `feature/6.docs-search` |
| 7 | **P1-8 table steps 6–9** — per-cell undo isolation, grid paste, arrow-key cell navigation, Move row, remote-caret tints | editable-table spec | ✅ `feature/7.table-steps` |
| 8 | **MCP**: stdio bridge package (`nodum-mcp`) + SSE responses with progress for long tools | onboarding-docs-mcp goal | ✅ `feature/8.mcp-sse-stdio` |
| 9 | e2e flakes: `split-panes.spec.ts` ⌘\ and `switcher-extras.spec.ts` ⌘Enter | carried over | ✅ `feature/8.mcp-sse-stdio` (root cause in the switcher) |
| 10 | **Release v3.3.0** — migrations, secrets, `dev` → `main`, tag, prod-compose smoke | editor-fixes P3-7 | ☐ |

## Working rules (unchanged)

Verify live before claiming; a test for every fix, shown to fail without it; no
speculative changes; `make verify` before commit; full Playwright before merge;
never a secret in the repo; branches
`<kind>/<N>.<slug>_maqbool_<DDMMYYYYHHMM>` as a chain.

## Progress log
- **2026-08-19 — #1 collab under `--workers 4`.** One shared seed per room
  (Redis SET NX), late-joiner state sync, stale-seed fallback to the DB, a
  single persist owner per room, a per-save lock so a REST reset is applied
  once, a closing gate for the join/teardown race, and **presence fanout**
  across workers (awareness was never relayed — remote cursors only showed when
  both people hit the same worker). Client: peers' edits stay out of
  CodeMirror's history (⌘Z is local); y-codemirror's second undo stack is off.
  Proof: five new integration tests with a second `CollabServer` in-process
  (convergence, late join, stale seed, single-apply reset, teardown race), each
  shown failing on per-worker seeds; the collab e2e run 6× against a real
  `uvicorn --workers 4` with rooms held by up to three workers — all green.
  `docs/collab.md` rewritten to match.
- **2026-08-19 — #2 undo/redo.** Mode and editor prefs are Compartments
  (reconfigure, never remount); the editor keeps a per-(pane, note) history
  snapshot across unmounts (tab switch, reading view), restored only when the
  document is byte-identical to the one it was taken from, LRU of 24; explicit
  `Ctrl-Shift-Z` redo for Windows; ⌘U stays underline (documented). e2e covers
  tab switch, mode switch, reading-view round trip and the Windows chord, and
  fails on the old editor.
- **2026-08-19 — #3 explorer click + heading links.** A click in the explorer
  reads the note in the current tab (Obsidian; pinned tabs are never taken
  over); ⌘-click and "Open in new tab" add one; Enter in the explorer reuses
  the tab too. `[[Note#Heading]]` lands on the heading in live preview (caret
  on the heading line, scrolled to the top) and in reading view, via a
  `pendingHeading` request the showing pane consumes. e2e for both; the tab-count
  suites now use `openNoteInNewTab` (⌘-click) where they mean "another tab".
- **2026-08-19 — #4 streaming AI replies.** `ai_providers.stream_turn` parses
  each provider's streaming format (OpenAI/Qwen chunks with tool-call
  fragments, Anthropic content-block events, Gemini `streamGenerateContent`);
  `chat_with_vault_events` runs the tool loop as an event stream (status /
  delta / action / reset / done / error) and the JSON endpoint consumes the
  same generator; `POST …/chat/stream` is SSE (`Cache-Control: no-transform` —
  without it the dev proxy's gzip buffered the whole stream, found by the e2e).
  Panel shows the reply as it arrives and what the assistant is doing. Tests:
  4 unit (parsing per provider, error mapping), 3 integration (framing, tool
  status + persistence, error → nothing stored, JSON path), e2e stub streams
  and asserts a partial reply is visible before the whole.
- **2026-08-19 — #5 per-vault AI keys.** `ai_credentials.vault_id` (migration
  0019; two partial unique indexes: one key per provider per account, one per
  provider per vault); the vault's active provider lives in `vault.settings.aiProvider`;
  `resolve(vault_id=…)` prefers the vault's own keys and falls through to the
  account's; status reports both scopes and the effective one. Settings → AI
  has a *Keys for* switch (account / only this vault) and says which key chat
  in this vault uses. Tests: precedence + isolation + cascade (integration),
  e2e saves a vault-only key through the UI and proves the stub receives it in
  that vault and the account key in another.
- **2026-08-19 — #6 docs full-text search.** The loader strips each article to
  plain text at build time; the rail ranks title › heading › summary › body and
  shows the sentence a body-only match was found in. e2e: a phrase that only
  appears in the MCP article's body finds it with a snippet.
- **2026-08-19 — #7 tables, steps 6–9.** Per-cell undo isolation (a new cell
  starts a history group; ⌘Z/⌘⇧Z/Ctrl+Y inside a cell drive CodeMirror's
  history, not the browser's contenteditable undo); grid paste (tab-separated
  text or an HTML table) writes into the table from the focused cell, growing
  it, as one transaction and one undo step — a single value pastes as text;
  arrow keys walk between cells at the text's edges, Tab lands at the end;
  Move row up/down (toolbar, ⌥↑/⌥↓, context menu); focus follows structural
  commands (`focusTableCell` is consumed now); under collab the cell a peer is
  in is tinted with their colour via an awareness field (the parked caret
  could never name the cell). e2e: arrows, move, paste + single undo, per-cell
  undo, collab tint; a crash found on the way (posAtDOM on a detached widget)
  fixed.
- **2026-08-19 — #8 MCP: SSE + progress, stdio bridge.** Each POST is now
  answered as a short SSE stream (the Streamable HTTP default), so a long tool
  can send `notifications/progress` on the way — `import_markdown` reports
  every 10 notes, the link pass and the attachments through a new
  `import_zip(progress=…)` hook; the official SDK client shows 6 events for a
  30-file import, `claude mcp add` still ✔ Connected, the web e2e parses
  frames. `packages/nodum-mcp`: a stdio ⇄ HTTP bridge (official TS SDK) that
  mirrors tools/resources/prompts with the token in env; smoke-tested over
  stdio against the dev API (36 tools, list_vaults). **Not published to npm**
  — do not advertise `npx nodum-mcp` until the name is ours; the docs point at
  the checkout.
- **2026-08-19 — #9 the two flakes had one cause.** The quick switcher's
  results lag typing (150 ms debounce + a round trip); Enter / ⌘Enter pressed
  in that window acted on the *previous* query's list — in a fast hand that
  opens the wrong note, in the e2e it was ⌘\ and ⌘Enter failing ~1 run in 6.
  Enter now waits for the list that matches what was typed and acts once.
  8/8 and 6/6 on the two specs afterwards.
