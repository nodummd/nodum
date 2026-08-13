# Nodum — Working Backlog (single source of truth)

> **How to use:** every work session starts by reading this file top-to-bottom
> and picks the first unchecked item in the active sprint. Check items off
> with the date when the acceptance criteria pass (tests + browser verify).
> Suites must stay green: currently **80 backend + 51 e2e**. Feature branches
> off `dev`, merged `--no-ff`, pushed. Release checkpoints are marked 🏁.
>
> ALL SPRINTS COMPLETE (2026-08-13): Phase A-C shipped v1.0.0→v2.0.0;
> Phase D shipped v2.1.0→v3.0.0. Remaining ideas live in the Icebox. Created 2026-08-12 · supersedes the stale "queued" table in
> `nodum-audit-and-roadmap.md` (kept for history/context).

**Status legend:** `[ ]` todo · `[x] YYYY-MM-DD` done · `[~]` in progress

---

## Sprint 1 — Hardening (finish the audit tail)

- [x] 2026-08-12 **S1.1 Stream attachment uploads** (P2) — `api/v1/attachments.py` reads
  the whole body into RAM before the size check.
  *Do:* read the UploadFile in chunks (1MB), abort with 422 the moment the
  running total exceeds `MAX_ATTACHMENT_SIZE_BYTES`; only then assemble/pass
  bytes to the service.
  *Accept:* test uploads a >25MB stream and gets 422 without memory spike;
  existing attachment tests green.

- [x] 2026-08-12 **S1.2 Access-token revocation** (P3) — tokens stay valid ≤15min after
  logout/password change.
  *Do:* Redis denylist `revoked_jti:{jti}` (TTL = remaining token life) set on
  logout + change-password (all session JTIs? access tokens aren't stored —
  instead deny by `user_id + iat < revoked_at` marker: `auth_revoked:{user_id}`
  = timestamp, TTL 15min; `get_current_user_id` rejects tokens with iat older).
  *Accept:* test: logout → old access token 401s immediately.

- [x] 2026-08-12 **S1.3 Signup in one transaction** (P3) — signup + default vault are
  separate commits; crash strands a vaultless account.
  *Do:* single transaction for user + welcome vault (move commit to the end;
  login still separate).
  *Accept:* existing signup tests green; new test asserts vault exists in the
  same request even if login step is skipped.

- [x] 2026-08-12 **S1.4 Attachment S3/DB ordering** (P3) — upload puts S3 object before
  DB row; DB failure orphans the object. Delete removes S3 before DB.
  *Do:* upload: S3 put → DB insert → on DB failure, best-effort S3 delete.
  Delete: DB row first, then best-effort S3 delete (orphan tolerable, missing
  row not).
  *Accept:* code order verified; tests green.

- [x] 2026-08-12 **S1.5 Refresh roadmap doc** — mark the fixed "queued" items in
  `nodum-audit-and-roadmap.md` as done so the two docs agree.

## Sprint 2 — Parity core (what Obsidian users miss first)

- [x] 2026-08-12 **S2.1 Code-block syntax highlighting (shiki) + mermaid diagrams** (M)
  *Do:* reading view: `@shikijs/rehype` (theme matching Obsidian dark) +
  client-side mermaid component for ```mermaid fences (research: never bundle
  rehype-mermaid). Live preview: shiki-highlighted block widget for fenced
  code when cursor outside (StateField), mermaid rendered the same way.
  *Accept:* e2e: code fence shows colored tokens in both views; mermaid fence
  renders an SVG diagram.

- [x] 2026-08-12 **S2.2 Aliases** (M) — frontmatter `aliases:` must resolve.
  *Do:* extract aliases on save into `note_aliases(note_id, alias)` w/
  uq(vault, lower(alias)) + index (migration 0010); wikilink resolution
  (`_resolve_targets`, `resolve_links_for_new_note`) matches aliases; quick
  switcher returns alias matches labeled "↳ alias of X".
  *Accept:* backend tests: [[Alias]] resolves to the note; switcher finds by
  alias; e2e switcher shows alias row.

- [x] 2026-08-12 **S2.3 Note version history** (M) — server-side snapshots.
  *Do:* `note_versions(note_id, content, created_at)` (migration with S2.2);
  snapshot on save when content changed AND last snapshot >5min old; prune
  to `NOTE_VERSIONS_KEPT=50` inline on snapshot (stronger than celery); endpoints
  list/get/restore; UI: "Version history" palette command → dialog listing
  versions with restore button.
  *Accept:* backend: edit → versions listed → restore returns old content;
  e2e: palette opens dialog, restore round-trips.

- [x] 2026-08-12 **S2.4 %%comments%% hidden in reading view** (S) — strip `%%…%%`
  outside code spans in the reading pre-processor; in live preview style
  them faint (visible while editing = Obsidian behavior).
  *Accept:* e2e: comment text visible in live, absent in reading.

- [x] 2026-08-12 **S2.5 Quick-switcher extras** (S) — Shift+Enter force-creates even on
  a match; ⌘Enter opens in background (no tab switch).
  *Accept:* e2e covers both.

🏁 ~~**Release v1.2.0**~~ ✅ 2026-08-12 — dev→main merged, tagged v1.2.0, prod-compose smoke passed (signup, alias switcher + backlink, version restore, search on the verify stack; migration 0010 applied).

## Sprint 3 — Parity polish

- [x] 2026-08-12 **S3.1 Graph groups + settings persistence** (M) — color-by-query rows
  (query matches path:/tag:/text against nodes; first match wins, Obsidian
  rule), persisted with filters+forces into `vaults.settings.graph`.
  *Accept:* e2e: add group, node recolors, survives reload.
- [x] 2026-08-12 **S3.2 Nested tag pane + click-to-search** (S) — tag pane renders the
  `a/b/c` hierarchy as a collapsible tree; clicking a tag runs `tag:` search.
  *Accept:* e2e: nested display + click populates search.
- [x] 2026-08-12 **S3.3 Page preview popover** (S–M) — Cmd/Ctrl+hover over a wikilink
  (editor + backlinks panel) shows a floating ReadingView excerpt.
  *Accept:* e2e: hover with modifier shows preview content.
- [x] 2026-08-12 **S3.4 Editable properties widget** (M–L) — field-level editing in the
  live-preview properties card (text/number/checkbox/date/list pills) writing
  YAML back into the document.
  *Accept:* e2e: edit a value in the card → source frontmatter updated.
- [x] 2026-08-12 **S3.5 Graph hover polish** (S) — dim non-neighbors on hover (research
  spec: ~0.2 alpha, eased), accent ring stays.
  *Accept:* visual check + no perf regression at welcome-vault scale.

## Sprint 4 — Scale & ops (before real traffic)

- [x] 2026-08-12 **S4.1 Payload caps** — tree/graph/backlinks endpoints get hard caps +
  `truncated: true` markers (tree: 20k items; graph: 20k nodes; backlinks:
  200 sources) so 100k-note vaults degrade gracefully instead of shipping
  20MB JSON.
- [x] 2026-08-12 **S4.2 Unlinked-mentions cost** (decided: no trigram index; LIMIT + SET LOCAL statement_timeout=2s, graceful timed_out response) — only compute on explicit pane view
  (already on-demand) + add `pg_trgm` GIN on content? Decide: measure first;
  if index too heavy, cap scan with `LIMIT` + `statement_timeout`.
- [x] 2026-08-12 **S4.3 Redis separation** — cache blobs vs rate-limit counters in
  different logical DBs; raise prod maxmemory guidance in compose comments.
- [x] 2026-08-12 **S4.4 Web observability** — wire Sentry (env-gated) in web; add web
  container healthcheck + `depends_on: condition: service_healthy` in prod
  compose.
- [x] 2026-08-12 **S4.5 Deploy & backup docs** — `docs/deploy.md`: Caddy reference
  config for nodum.md (TLS, proxy to web:3000), prod checklist;
  `docs/backup.md`: pg_dump + MinIO mirror + restore drill.

## Sprint 5 — Collaboration groundwork (Phase C finale)

- [x] 2026-08-12 **S5.1 CRDT plumbing** — Yjs doc per note; `y-codemirror.next` binding
  behind a feature flag; websocket endpoint (FastAPI) relaying updates
  (y-websocket protocol), Redis pub/sub fanout across workers.
- [x] 2026-08-12 **S5.2 Presence** — remote cursors/selections with user colors.
- [x] 2026-08-12 **S5.3 Persistence strategy** — periodic Yjs state vector → note
  content sync (existing autosave path stays authoritative for non-collab
  sessions); conflict story documented.
  *Accept (all):* two browser contexts edit one note live; both see each
  other's cursors; refresh keeps content; non-collab clients unaffected.

🏁 ~~**Release v2.0.0**~~ ✅ 2026-08-12 — dev→main merged, tagged v2.0.0, prod-compose smoke passed (signup, collab websocket seed+sync, graph, search; web container healthcheck green).

## Sprint 6 — Parity core leftovers (Phase D)

- [x] 2026-08-12 **S6.1 Block references** (L) — `[[Note#^id]]` / `![[Note#^id]]`
  end-to-end (also accept the loose `[[Note^id]]` form).
  *Do:* backend already resolves the note (target splits on `#`); add block
  slicing: shared block extractor (paragraph/list-item/blockquote ending in
  ` ^id`); embeds.tsx renders just the sliced block for `#^id` targets
  (heading embeds `#Heading` slice their section too); live-preview embed
  widget + reading view + page-preview popover all use the slicer; wikilink
  autocomplete offers `^ids` after typing `#^` in a resolved note.
  *Accept:* backend test: extractor slices blocks + heading sections; e2e:
  ![[A#^id]] shows only the marked paragraph in live+reading; [[A#^id]]
  navigates to A.

- [x] 2026-08-12 **S6.2 Split panes** (M) — two side-by-side editor groups.
  *Do:* workspace store: panes: [{tabs, activeTabId}] (max 2), activePane;
  "Split right" (⌘\ + palette + tab context menu); drag tab between panes
  skipped (icebox); close pane when last tab closes; explorer/switcher open
  into the active pane.
  *Accept:* e2e: split, open different notes side by side, close pane.

- [x] 2026-08-12 **S6.3 Pinned tabs + navigation history** (M)
  *Do:* pin/unpin via tab context menu (pinned tabs sort first, no close
  button, ⌘W skips); per-pane back/forward stacks (⌘[ / ⌘]) recording note
  opens; store-persisted.
  *Accept:* e2e: pin blocks close; back/forward walks history.

🏁 ~~**Release v2.1.0**~~ ✅ 2026-08-12 — dev→main merged, tagged, prod smoke passed (signup, block-ref backlinks, search, web healthcheck).

## Sprint 7 — Reach: mobile + PWA (Phase D)

- [x] 2026-08-12 **S7.1 Mobile-responsive workspace** (M–L)
  *Do:* < 768px: left/right sidebars become overlay drawers (hamburger +
  panel toggles), tab bar scrolls, editor padding tightens, graph controls
  collapse behind a gear button; touch-friendly hit areas (min 40px).
  *Accept:* e2e with mobile viewport: drawers open/close, note editable,
  no horizontal scroll.

- [x] 2026-08-13 **S7.2 PWA + share-target web clipper** (share_target uses GET per web-share spec; /clip handles params + manual paste) (M)
  *Do:* manifest.json + icons + service worker (app-shell cache only, no
  offline vault promises); share_target POST route `/clip` that creates a
  note from shared title/text/url into a "Clippings" folder; a /clip page
  as manual fallback (paste URL/text → note).
  *Accept:* manifest served + installable (lighthouse-ish check via
  headers), e2e: POST to share-target creates the clipping note.

🏁 ~~**Release v2.2.0**~~ ✅ 2026-08-13 — dev→main merged, tagged, prod smoke passed (PWA manifest/sw/clip served, clippings flow via API, web healthy).

## Sprint 8 — Accounts & publishing (Phase D)

- [x] 2026-08-13 **S8.1 Google OAuth** (M) — hourly's oauth_connection pattern.
  *Do:* oauth_connections table (migration), /auth/google/start (state in
  Redis) + /auth/google/callback (code→token→userinfo, link-or-create user,
  set refresh cookie, redirect to app); frontend "Continue with Google"
  buttons on login/signup; account settings shows linked provider.
  Env-gated: GOOGLE_CLIENT_ID/SECRET (buttons hidden when unset).
  *Accept:* backend tests with mocked Google endpoints: new-user create,
  existing-email link, state mismatch 400; UI button renders when enabled.

- [x] 2026-08-13 **S8.2 Whole-vault publishing** (L)
  *Do:* vault_publications table (slug, vault_id, enabled); publish toggle
  in settings; public site at /s/{slug} (SSR): note list nav + rendered
  notes at /s/{slug}/{note-path}, wikilinks rewritten to site links,
  private notes excluded via frontmatter `publish: false`.
  *Accept:* backend: publish vault → public endpoints list/serve notes
  without auth, unpublish 404s; e2e: browse published site nav.

🏁 ~~**Release v2.3.0**~~ ✅ 2026-08-13 — dev→main merged, tagged, prod smoke passed (providers flag, vault site anonymous read).

## Sprint 9 — Canvas & long tail (Phase D)

- [x] 2026-08-13 **S9.1 Canvas MVP** (XL) — Obsidian-compatible .canvas boards.
  *Do:* canvases table (vault_id, name, data JSONB in Obsidian's
  JSON Canvas format: nodes[text|file|link], edges); CRUD API; canvas tab
  kind in workspace; renderer: pan/zoom stage (CSS transform), draggable/
  resizable cards, text cards (markdown), file cards (note embeds), edge
  drawing between card sides, JSON Canvas import/export.
  *Accept:* backend CRUD tests; e2e: create canvas, add text card + note
  card, connect edge, reload persists.

- [x] 2026-08-13 **S9.2 Graph time-travel replay** (creation-ordered reveal — deterministic even with same-second timestamps) (S–M) — time slider on the graph
  filtering nodes by note created_at (play button animates the vault
  growing).
  *Accept:* e2e: slider hides newer notes; play reaches full graph.

- [x] 2026-08-13 **S9.3 Importer niceties** (S–M) — zip import: extract binary files
  into attachments (wire into vault_io), map .obsidian/app.json basics
  (daily-note format/folder) into vault settings when present.
  *Accept:* backend test: zip with png + .obsidian config → attachment
  exists, settings mapped.

🏁 ~~**Release v3.0.0**~~ ✅ 2026-08-13 — dev→main merged, tagged, prod smoke passed (canvas round-trip, graph created_at, web healthy).

## Phase E — Obsidian-grade smoothness & settings (added 2026-08-13)

> **Goal:** nodum must FEEL like Obsidian, not just look like it. Two
> measurable outcomes: (1) the graph updates incrementally — creating,
> renaming, or deleting notes while the graph is open must never
> re-randomize the layout or jump the viewport, and panel controls match
> Obsidian's (search, arrows, node size, link thickness, link force);
> (2) a tabbed settings window whose options genuinely change behavior
> (editor view defaults, line numbers, readable width, spellcheck, font
> size, accent colour, new-note location, delete confirmation, ⌘-hover
> toggle). Evidence: docs/research/obsidian-study-2.md. Ship as v3.1.0.

## Sprint 10 — Graph smoothness

- [x] 2026-08-13 **S10.1 Incremental graph engine** (L)
  *Do:* per-vault position map (ref, survives refetches) keyed by node id;
  on data change diff old/new node sets — reuse kept positions, seed new
  nodes at the centroid of their linked neighbors (+small jitter, fallback
  viewport center), drop removed ones; apply via cosmos set* calls with a
  gentle sim reheat instead of destroy/recreate; fitView ONLY on first
  load of a vault's graph; slider/filter/group changes preserve positions.
  *Accept:* e2e with graph open: existing node screen position drifts
  <80px after another note is created via API + query invalidation; the
  new node appears; zoom level unchanged (no fit jump).

- [x] 2026-08-13 **S10.2 Graph panel parity** (M)
  *Do:* Filters gain a search box (reuse the groups query matcher —
  path:/tag:/text) that dims/hides non-matching nodes; Display section:
  arrows toggle (cosmos linkArrows), node size ×0.1-5 and link thickness
  ×0.1-5 sliders; Forces gains link force 0-1 (spring) with ranges mapped
  from Obsidian (centre 0-1, repel 0-20 scaled, link distance 30-500
  scaled); all persisted in settings.graph.
  *Accept:* e2e: search filter reduces node count; sliders persist across
  reload; arrows toggle flips config without layout reset.

## Sprint 11 — Settings depth

- [x] **S11.1 Tabbed settings window** (M) — 2026-08-13
  *Do:* rebuild the settings modal as an Obsidian-style vertical-tab
  layout (General · Editor · Appearance · Files & links · Hotkeys · Vault
  · Publish · Collab); migrate every existing option into the right tab;
  wider modal, per-tab scroll.
  *Accept:* e2e navigates 3+ tabs and finds migrated options.

- [ ] **S11.2 Editor settings that actually work** (M-L)
  *Do:* user-level settings (users.settings JSONB via authApi.updateMe):
  defaultViewMode for new tabs (live/source/reading), readableLineLength
  (toggle → editor max-width), showLineNumbers (CM6 lineNumbers()),
  spellcheck (contentDOM spellcheck attr), editorFontSize (14-24 slider →
  CSS var). Applied live in MarkdownEditor + ReadingView.
  *Accept:* e2e: toggle line numbers → .cm-gutters visible; font size
  slider changes computed font-size; new tab opens in configured mode.

- [ ] **S11.3 Appearance + files & links + preview toggle** (M)
  *Do:* accent colour picker (user setting; overrides the accent CSS vars
  live and on boot); default new-note location (vault setting: root |
  current-folder | named folder — used by ⌘N, switcher create, wikilink
  ghost create); confirm-before-delete toggle (explorer + palette +
  canvas delete paths); page preview "require ⌘ on hover" toggle.
  *Accept:* e2e: accent change reflected in a button's computed color and
  survives reload; delete shows confirm when enabled; new note lands in
  the configured folder.

## Sprint 12 — Reference + release

- [ ] **S12.1 Hotkeys reference tab** (S) — searchable read-only list of
  every nodum shortcut (editor, workspace, graph, canvas).
  *Accept:* e2e: search narrows the list.
- [ ] **S12.2 🏁 Release v3.1.0** — full suites green, merge dev→main,
  tag, prod-compose smoke (incl. a settings round-trip), backlog + master
  plan close-out.

## Icebox (still later)
- Cross-pane tab drag & drop · graph clustering by folder
- Real-time multi-user share links (collab across accounts)
- E2E encryption at rest

## Done log
_(move checked items here with dates during long sprints to keep the top clean)_
