# GOAL — First-run onboarding, a Demo Workspace, in-app documentation, and MCP (Aug 2026)

Working document for the current mandate. Four things, in order:

- **A. Demo Workspace** — a one-time offer to create a populated vault (our demo
  notes, folder colours, graph groups, links) so a new user can play before
  they write anything.
- **B. Onboarding** — a first-run walkthrough of the workspace, skippable and
  closable at every step, re-runnable from Help.
- **C. Documentation** — a place a user can go at any time to look up what a
  specific button or feature is for, with an example and a real screenshot.
- **D. MCP** — Nodum as an MCP server, so any MCP-capable LLM client can do
  everything the user can: vaults, notes, folders, links, colours, import,
  export, tags, search, and more.

Companion to `tasks/nodum-master-plan.md`; log outcomes there as items land.
Successor to `tasks/nodum-vaults-ai-goal.md` (complete).

## Working rules (carried forward — they have already paid for themselves)

1. **Verify before claiming.** Every behaviour is checked live in the browser
   (web dev server on :3000; API on :8000; demo@vorreix.com / demopass123).
2. **Prove the test is not vacuous.** After writing a test, revert the fix and
   watch it fail.
3. **No speculative changes.** If it cannot be demonstrated, do not "fix" it.
4. `make verify` (backend + web gates) on every change; full Playwright before
   merge (`BASE_URL=http://localhost:3000 npx playwright test`).
5. **Never commit a secret.** This repo is public. New env vars land in
   `deploy/.env.example` with placeholders only. Fixtures never contain a real
   key; test keys are `fake-…`, never `sk-…` (it trips the secret scanner).

## Branching (NEW — supersedes `feature/<name>`)

Branches are named `<kind>/<N>.<slug>_<contributor>_<DDMMYYYYHHMM>` and are
created **as a chain**: each new branch starts from the tip of the previous one,
the first from `dev`. Every branch merges into `dev` with `--no-ff` when done.

- `<kind>` ∈ `feature` · `hotfix` · `chore` · `bug`
- `<N>` — running number of the branch in the chain (1, 2, 3 …)
- `<slug>` — short lowercase what-it-is (`onboarding`, `mcp-server`)
- `<contributor>` — the person's handle (`maqbool`)
- `<DDMMYYYYHHMM>` — 24-hour timestamp when the branch was created

Example chain: `dev → feature/1.demo-workspace_maqbool_190820260150 →
feature/2.onboarding_maqbool_190820260430 → chore/3.docs_maqbool_190820260900`.

Commits are authored as `maqboolthoufeeq.t@gmail.com` (repo-local git config).

---

# A. Demo Workspace ✅ DONE 2026-08-19 (`f9ec6d6`)

**Source of truth.** The demo vault "Second Brain" lived only in the local dev
database. It is now a repo fixture: `back/app/fixtures/demo_vault/**/*.md`
(209 notes, 45 KB) plus `back/app/fixtures/demo_vault.json` — folder colours
**keyed by path** (item ids differ per install), the 13 graph groups (tag
queries — portable as-is), and the canvas background.

**Backend.** `POST /vaults/demo` → `vault_service.create_demo_vault(user_id)`:
zips the fixture in memory, creates a vault named "Demo Workspace" (suffix `2`,
`3` if taken), imports through the existing `import_zip` (links + tags resolve in
its second pass), then maps the manifest's colour paths to the created ids and
writes `settings.itemColors` / `settings.graph` / `settings.canvasBackground`.
Idempotent per click; a second demo is allowed (it is just a vault).

**Frontend.** The one-time question is the last step of onboarding, and also
reachable later from Settings → Vault ("Create a demo workspace"). Answering
persists `demoOffered: true` on `users.settings` so it never asks twice. Yes
opens the new vault in place (first run — nothing to preserve).

**Acceptance.** A fresh account clicks Yes and lands in a vault with the
Areas/Health folder purple, Books green, 13 coloured graph groups, and every
wikilink resolved (0 ghosts among the demo's own links). No is remembered.

# B. Onboarding ✅ DONE 2026-08-19 (`e58503f`)

A first-run overlay on the workspace, driven by `users.settings.onboardingDone`
(absent → show). Steps, each with a short line and a spotlight on the real UI:
1 Welcome · 2 Files & folders (explorer) · 3 Writing (editor, `[[` links) ·
4 The graph · 5 Search & the palette (⌘O / ⌘P) · 6 Panels (backlinks, tags, AI)
· 7 Demo workspace? (yes / no) · Done (link to docs).

- **Skip** and **×** on every step; Esc closes. Any exit marks it done.
- Re-run from Help (ribbon "?") → "Show the tour again", and Settings → General.
- Keyboard: ← → advance, Esc closes; focus trapped in the card.
- Never shown on mobile widths (the drawers make spotlights meaningless).

# C. Documentation ✅ DONE 2026-08-19 (`c676969`)

`/docs` — a public, static section of the web app: a left nav of articles by
section, a search box that filters titles and headings, and articles rendered
from markdown in `web/src/content/docs/`. Each article: what it is, when you'd
use it, an example, a screenshot. Screenshots are captured from the real UI by
`web/scripts/docs-screenshots.ts` (Playwright against a fresh account with the
demo workspace) into `web/public/docs/`, so they are honest and re-capturable.

Entry points: ribbon Help "?" (opens `/docs` in a new tab), command palette
"Help: Open documentation", onboarding's last step, Settings → General.

Articles (first cut): getting started · files & folders · writing (live
preview / source / reading, formatting menu) · links & backlinks · tags ·
graph view (filters, forces, groups, text size, hover) · search & switcher ·
command palette & hotkeys · tabs, panes & navigation · canvas · daily notes &
templates · bookmarks · vaults · import & export · attachments · publish &
sharing · web clipper · collaboration · plugins · AI · MCP · settings.

# D. MCP server ✅ DONE 2026-08-19 (`a958d5b`)

Nodum speaks MCP over **Streamable HTTP** at `/mcp` (official `mcp` Python SDK,
mounted in FastAPI). Auth is a per-user **MCP token** — minted in Settings → MCP,
shown once, stored hashed (the clipper-token pattern), revocable — sent as
`Authorization: Bearer …`. Every tool resolves the user from the token and goes
through the same services and `get_owned_vault` checks the UI does.

Tools (all thin wrappers over existing services):
- vaults: `list_vaults` `create_vault` `rename_vault` `delete_vault`
- notes: `list_notes` `search_notes` `read_note` `create_note` `update_note`
  (replace / append) `rename_note` `move_note` `delete_note` `link_notes`
  `get_backlinks` `get_outgoing_links` `set_note_tags`
- folders: `get_tree` `create_folder` `rename_folder` `move_folder` `delete_folder`
- colours & graph: `set_item_color` `list_item_colors` `set_graph_groups` `get_graph`
- import/export: `import_markdown` (many files at once) `import_attachment`
  (base64 image/file → embed syntax) `export_vault` (zip, base64) `list_attachments`
- more: `list_tags` `daily_note` `list_templates` `list_canvases`
  `create_canvas` `list_bookmarks` `bookmark_note`
- resources: `nodum://vaults`, `nodum://vault/{id}/note/{path}`

Settings → MCP shows the server URL, mints/revokes the token, and gives copy-
paste config for Claude Desktop (via `mcp-remote`), Claude Code, and Cursor.
`/docs/mcp` explains it with the same snippets.

**Acceptance.** With a token, `initialize` → `tools/list` → `tools/call` over
raw JSON-RPC creates a vault, imports notes, links them, colours a folder and
reads the graph; a wrong token gets 401; a revoked token stops working; the
token never appears in any GET.

## Sequence

| # | Branch | Item |
|---|--------|------|
| 1 | ~~`chore/1.branching-strategy_…`~~ | ✅ CLAUDE.md + README |
| 2 | ~~`feature/2.demo-workspace_…`~~ | ✅ 207-note fixture, POST /vaults/demo, one-time offer, Settings → Vault |
| 3 | ~~`feature/3.onboarding_…`~~ | ✅ spotlight tour, Skip/×/Esc → demo question, Help "?" |
| 4 | ~~`feature/4.docs_…`~~ | ✅ /docs, 21 articles, 28 real screenshots via `npm run docs:shots` |
| 5 | ~~`feature/5.mcp-server_…`~~ | ✅ /api/v1/mcp, 36 tools, tokens, Settings → MCP, /docs/mcp |

## What was found on the way (and fixed)

- **Vault-to-vault navigation in one tab leaked the previous vault's tabs.** Child
  effects write to the store before the page's `setActiveVault`; the store now
  keys writes by the vault its panes belong to, and the page waits for the store
  before mounting the workspace.
- **Two concurrent `PATCH /auth/me` lost each other's keys** (the tour finishing
  and the demo answered in one click). Row lock on the merge; a six-way
  concurrency test proves it; the tour sends one write anyway.
- **Probe residue in the demo export**: pasted-image embeds, a stray folder, a
  duplicated note, links to a deleted note, and one note whose body had been
  quadrupled by an append probe. All scrubbed; the fixture now has zero
  unresolved links of its own (asserted).
- **`import_zip` strips a shared root folder** (right for zipped vaults, wrong for
  an explicit batch) — `unwrap_root=False` for the MCP import.
- **The vault switcher list went stale** when a vault was created elsewhere
  (MCP, another tab) — it refetches on open.
- **A Starlette Mount 307s the exact path** — the MCP endpoint is a Route.

## After the adversarial review (2026-08-19, `bug/7.review-fixes_…`)

A 39-agent review over the merged work (five lenses: MCP security, MCP
correctness, onboarding, workspace store, docs and demo) confirmed 34 findings;
all fixed and covered:

- **MCP cross-tenant read** — `_resolve_note`'s title fallback (and `_find_folder`,
  `bookmark_note`, `list_item_colors`, the note resource) queried by vault id
  without an ownership check; a user with any token could read another user's
  note by title, enumerate titles with `%` patterns, and insert bookmarks into a
  foreign vault. Every lookup now starts with `get_owned_vault`, the title match
  is exact (no ILIKE patterns), `list_item_colors` scopes ids to the vault, and
  the error is "Vault not found." for every foreign reference. Test:
  `test_tools_never_cross_users` (title / id / path / pattern / resource / nine
  write tools) + `test_item_colors_only_resolve_ids_in_this_vault`.
- **Silent misfiling** — `ensure_folder_path` swallowed an invalid segment and
  returned the last good parent, so `create_note(folder="Bad|Name")` filed the
  note at the root and `move_note` moved a note *out* of its folder. It returns
  a `ServiceResponse` now, validated before anything is created; the REST
  `folder_path`, the AI tool and the clipper all surface the error.
  `move_folder` no longer creates its destination.
- MCP body cap raised from the SDK's 4 MiB to 32 MiB (a 3 MB attachment
  arrives; a 5 MB+ one gets a sentence, not a 413); nested paths in the note
  resource (`{+path}`); unexpected tool exceptions logged and replaced by a
  generic ToolError; per-token rate-limit buckets; honest rename/move
  docstrings (links are not rewritten).
- **Tour** — × / Esc on the demo question is "not now" (no dialog re-asks);
  focus lands on the card once per step (not every 400 ms); ⌘-chords are
  swallowed while the tour is up (⌘O no longer opens the switcher under the
  veil); Tab is trapped in the card and the rest of the page is `inert`; the
  veil and card follow a resize on centred steps; the card never exceeds the
  viewport width; hidden sidebars/ribbon are shown for the tour and restored;
  focus is not handed back to the Help trigger; one PATCH for "not now".
- `PATCH /auth/me` is refreshed-and-retried on 401 like every other call (an
  answer given after the access token expired was silently lost).
- Deleting the vault open in this tab hops to another vault instead of
  "Loading vault…" forever.
- Docs corrected where they promised what the app does not do (drag-to-move,
  drop-to-import, demo plugin, template-at-cursor, settings tab for page
  preview, `path:` semantics, related-notes wording, tags menu label, MCP
  example count); the demo now has a real daily-note folder + template with
  variables; the importer reads `.obsidian` `attachmentFolderPath`; a
  "Split down" palette command exists.

## Second pass (2026-08-19, `bug/8.review-fixes-2_…`)

A 27-agent pass over the fix commit itself (regressions, tour a11y/UX, MCP
security 2, MCP correctness 2, docs 2) confirmed 22 more, all fixed:

- **Regression caught**: the new "vault is gone → dispatcher" redirect fired on
  a *stale* vault list right after creating the demo vault (the refetch was in
  flight), bouncing a first visit back to the old vault. It waits for a fresh
  list now, and the demo hook seeds the cache with the new vault. e2e delays
  the refetch by 1.5 s to prove it.
- **Regression caught**: keying the rate limiter on any `nodum_…` bearer let a
  rotating junk token escape the per-IP bucket. A token gets its own bucket
  only after the MCP gate verified it (short-lived Redis marker); junk stays
  per-IP.
- **Password reset / change now revoke every MCP token** (a stolen token used
  to survive both — the one moment revocation matters most). Documented.
- MCP: `list_attachments` crashed on any vault with attachments (`size` →
  `size_bytes`); `update_note(prepend)` no longer writes above the
  frontmatter; `link_notes` is idempotent and refuses self-links; the note
  resource returns "Vault not found." / "No note called …" instead of a bare
  "Error creating resource"; `/auth/change-password` is a credential path
  (its 401 must not trigger a refresh).
- Tour: only the workspace's own ⌘-chords are eaten (⌘R/⌘L/⌘C/⌘± pass
  through); the viewport is seeded from `window` so the first paint is
  centred (no 20 px jump).
- ⌘E had two owners (inline code in the editor *and* reading view) — the
  editor binding is gone, matching the Hotkeys tab and docs. Palette labels
  now match the docs and Hotkeys tab (*Delete current note*, *Bookmark
  current note*). Tags panel seeds `tag:#name` like the operator table.
- Docs: renaming does not rewrite links (aliases are the way to keep them),
  `[[Note#Heading]]` opens at the top, unlinked mentions have no one-click
  link, canvas interactions as they really are (toolbar / ⇧-click / double
  click), local graph has a Depth slider not "the same controls", explorer
  click opens a new tab, per-account vs per-vault toggles on Files & links.

## Third pass (2026-08-19, `bug/10.review-fixes-3_…`)

18 agents over the second fix commit and the surfaces not yet examined
(token lifecycle, demo service, first-run state machine, docs 3): 13
confirmed, all fixed:

- **Cross-account leak in one browser (high, pre-existing)** — logging out
  and in as another account through client-side navigation kept the TanStack
  cache (previous account's vault list, notes) and the persisted
  `activeVaultId`, so the new account landed in the old account's vault with
  its notes on screen; an open Settings dialog also survived and blocked the
  tour. The query cache is cleared whenever the identity changes; logout /
  expiry reset the transient workspace slice and forget the vault; the tour
  never opens over Settings. e2e: A's note, Settings open, palette Log out,
  B signs up via links — B lands in its own vault, sees nothing of A.
- Regression caught: putting `/auth/change-password` on the no-refresh list
  broke a change after token expiry. Reverted; the backend answers **403**
  for a wrong current password, so a 401 there means "expired" and refreshes.
- Claude Desktop config now passes the token through `env` (`Authorization:${AUTH_HEADER}`)
  — mcp-remote's documented workaround for Windows/Cursor splitting an
  `args` entry at a space. Docs updated.
- Token cap enforced under concurrent creates (advisory lock); a
  deactivated account's tokens stop working; the endpoint URL comes from
  `FRONTEND_BASE_URL` (behind an upstream TLS terminator the forwarded
  scheme is `http`).
- Two simultaneous demo creations: the loser takes "Demo Workspace 2"
  instead of a 500 (`create_vault`/`rename_vault` turn the unique-constraint
  race into `already_exists`).
- Daily notes on the **user's** clock: the web sends its local time, the
  MCP tool accepts `local_time`; the demo's daily notes moved to `Daily/`
  so the calendar button files next to them.
- Docs: publish (`publish: false`, slug), web clipper (the token can list
  vaults), canvas background label.

## Fourth pass (2026-08-19, `bug/11.review-fixes-4_…`) — regressions only

Backend lens: **dry**. Web lens: two, both from the sign-out hygiene change,
both fixed:

- The identity-change cache clear also fired on the boot-time
  loading → authenticated step, silently destroying queries already in flight
  on public pages — a signed-in visitor of `/p/<token>` could sit on
  "Loading…" forever. The first resolution is no longer treated as a change.
  e2e delays the public note past the session refresh.
- Sign-out no longer forgets the open vault: the same person logging back in
  returns to it (a different account never finds it in their list, and the
  cache is cleared anyway). e2e covers the round trip.

The loop is dry after this: three full passes plus a regressions-only pass;
the last found nothing outside its own predecessor's diff.

## Deliberately not done

- MCP over stdio as an installable package (`npx nodum-mcp`) — Streamable HTTP
  plus `mcp-remote` covers Claude Desktop; revisit if a client cannot send headers.
- Streaming (SSE) MCP responses — stateless JSON is enough for tool calls and
  proxies cleanly; add if a client needs server-initiated messages.
- Docs search across article bodies (titles + headings + summaries today).

