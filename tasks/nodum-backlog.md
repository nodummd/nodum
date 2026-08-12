# Nodum — Working Backlog (single source of truth)

> **How to use:** every work session starts by reading this file top-to-bottom
> and picks the first unchecked item in the active sprint. Check items off
> with the date when the acceptance criteria pass (tests + browser verify).
> Suites must stay green: currently **55 backend + 30 e2e**. Feature branches
> off `dev`, merged `--no-ff`, pushed. Release checkpoints are marked 🏁.
>
> Created 2026-08-12 · supersedes the stale "queued" table in
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

- [ ] **S2.3 Note version history** (M) — server-side snapshots.
  *Do:* `note_versions(note_id, content, created_at)` (migration with S2.2);
  snapshot on save when content changed AND last snapshot >5min old (or on
  title change); prune to `NOTE_VERSIONS_KEPT=50` (celery nightly); endpoints
  list/get/restore; UI: "Version history" palette command → dialog listing
  versions with restore button.
  *Accept:* backend: edit → versions listed → restore returns old content;
  e2e: palette opens dialog, restore round-trips.

- [ ] **S2.4 %%comments%% hidden in reading view** (S) — strip `%%…%%`
  outside code spans in the reading pre-processor; in live preview style
  them faint (visible while editing = Obsidian behavior).
  *Accept:* e2e: comment text visible in live, absent in reading.

- [ ] **S2.5 Quick-switcher extras** (S) — Shift+Enter force-creates even on
  a match; ⌘Enter opens in background (no tab switch).
  *Accept:* e2e covers both.

🏁 **Release v1.2.0** after Sprint 2 (merge dev→main, tag, prod-compose smoke).

## Sprint 3 — Parity polish

- [ ] **S3.1 Graph groups + settings persistence** (M) — color-by-query rows
  (query matches path:/tag:/text against nodes; first match wins, Obsidian
  rule), persisted with filters+forces into `vaults.settings.graph`.
  *Accept:* e2e: add group, node recolors, survives reload.
- [ ] **S3.2 Nested tag pane + click-to-search** (S) — tag pane renders the
  `a/b/c` hierarchy as a collapsible tree; clicking a tag runs `tag:` search.
  *Accept:* e2e: nested display + click populates search.
- [ ] **S3.3 Page preview popover** (S–M) — Cmd/Ctrl+hover over a wikilink
  (editor + backlinks panel) shows a floating ReadingView excerpt.
  *Accept:* e2e: hover with modifier shows preview content.
- [ ] **S3.4 Editable properties widget** (M–L) — field-level editing in the
  live-preview properties card (text/number/checkbox/date/list pills) writing
  YAML back into the document.
  *Accept:* e2e: edit a value in the card → source frontmatter updated.
- [ ] **S3.5 Graph hover polish** (S) — dim non-neighbors on hover (research
  spec: ~0.2 alpha, eased), accent ring stays.
  *Accept:* visual check + no perf regression at welcome-vault scale.

## Sprint 4 — Scale & ops (before real traffic)

- [ ] **S4.1 Payload caps** — tree/graph/backlinks endpoints get hard caps +
  `truncated: true` markers (tree: 20k items; graph: 20k nodes; backlinks:
  200 sources) so 100k-note vaults degrade gracefully instead of shipping
  20MB JSON.
- [ ] **S4.2 Unlinked-mentions cost** — only compute on explicit pane view
  (already on-demand) + add `pg_trgm` GIN on content? Decide: measure first;
  if index too heavy, cap scan with `LIMIT` + `statement_timeout`.
- [ ] **S4.3 Redis separation** — cache blobs vs rate-limit counters in
  different logical DBs; raise prod maxmemory guidance in compose comments.
- [ ] **S4.4 Web observability** — wire Sentry (env-gated) in web; add web
  container healthcheck + `depends_on: condition: service_healthy` in prod
  compose.
- [ ] **S4.5 Deploy & backup docs** — `docs/deploy.md`: Caddy reference
  config for nodum.md (TLS, proxy to web:3000), prod checklist;
  `docs/backup.md`: pg_dump + MinIO mirror + restore drill.

## Sprint 5 — Collaboration groundwork (Phase C finale)

- [ ] **S5.1 CRDT plumbing** — Yjs doc per note; `y-codemirror.next` binding
  behind a feature flag; websocket endpoint (FastAPI) relaying updates
  (y-websocket protocol), Redis pub/sub fanout across workers.
- [ ] **S5.2 Presence** — remote cursors/selections with user colors.
- [ ] **S5.3 Persistence strategy** — periodic Yjs state vector → note
  content sync (existing autosave path stays authoritative for non-collab
  sessions); conflict story documented.
  *Accept (all):* two browser contexts edit one note live; both see each
  other's cursors; refresh keeps content; non-collab clients unaffected.

🏁 **Release v2.0.0** after Sprint 5.

## Icebox (unscoped / later)
- Block references `[[Note^block]]` end-to-end (L)
- Canvas (XL) · split panes / pinned tabs / nav history (M)
- Obsidian importer niceties: attachment files from zips, .obsidian config mapping
- Web clipper / PWA share-target · graph time-travel replay
- Mobile-responsive workspace layout
- Google OAuth (hourly's oauth_connection pattern)
- Public vault publishing (whole-vault sites with nav, not just single notes)

## Done log
_(move checked items here with dates during long sprints to keep the top clean)_
