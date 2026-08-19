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
| 3 | Explorer click opens in the **current** tab (Obsidian; ⌘-click = new tab); `[[Note#Heading]]` scrolls to the heading | review pass 2/3 doc-vs-code | ☐ |
| 4 | **Streaming AI replies** (SSE token stream into the chat pane) | vaults-ai goal | ☐ |
| 5 | **Per-vault AI keys** (a vault may override the account key/model) | vaults-ai goal | ☐ |
| 6 | **Docs full-text search** over article bodies | onboarding-docs-mcp goal | ☐ |
| 7 | **P1-8 table steps 6–9** — per-cell undo isolation, grid paste, arrow-key cell navigation, Move row, remote-caret tints | editable-table spec | ☐ |
| 8 | **MCP**: stdio bridge package (`nodum-mcp`) + SSE responses with progress for long tools | onboarding-docs-mcp goal | ☐ |
| 9 | e2e flakes: `split-panes.spec.ts` ⌘\ and `switcher-extras.spec.ts` ⌘Enter | carried over | ☐ |
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
