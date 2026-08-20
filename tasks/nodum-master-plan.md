# Nodum — Master Plan & Task Tracker

> **Nodum** (Latin: "knot/node") — an open-source, web-based knowledge management
> platform inspired by Obsidian (https://obsidian.md). Domain: **nodum.md**.
> Users sign up, create vaults, write linked markdown notes, and explore their
> knowledge graph — in the browser, multi-tenant, fast, and scalable.
>
> This file is the single source of truth for project state. Every work session
> starts by reading this file and ends by updating checkboxes + the Progress Log.

---

## 1. Product Vision

Obsidian is a local-first markdown knowledge base built on plain-text files with
`[[wikilinks]]`, backlinks, and an interactive graph view. It is **not open
source**. Nodum is the fully open-source web equivalent:

- **Multi-tenant SaaS**: signup/login, each user owns one or more **vaults**.
- **Everything Obsidian does in core**, in the browser, better UX where possible.
- **Massively scalable**: millions of users — async I/O everywhere, Redis
  caching, optimized queries, WebGL graph rendering, CDN-friendly frontend.
- **Completely open source**: no secrets in the repo, `.env.example` only,
  MIT license (revisit AGPL before public launch if SaaS-protection matters).

## 2. Obsidian Feature Inventory (research target = full core parity)

Legend: ✅ done · 🔨 in progress · ⬜ todo · 🔮 post-v1

### 2.1 Vault & Files
- ⬜ Vaults (create/rename/delete; user owns N vaults)
- ⬜ Folder tree (nested folders, create/rename/move/delete)
- ⬜ Notes = markdown documents (create/rename/move/delete/duplicate)
- ⬜ File explorer pane with drag-and-drop move
- ⬜ Import: upload .md files / zip of a vault (Obsidian-compatible)
- ⬜ Export: vault as zip of .md files (no lock-in — mirrors Obsidian's plain-file ethos)
- ⬜ Attachments (images/files) stored in S3/MinIO, embedded via `![[image.png]]`
- 🔮 Trash / restore deleted notes

### 2.2 Editor (CodeMirror 6 — same engine Obsidian uses)
- ⬜ Markdown editing with syntax highlighting
- ⬜ Live Preview mode (rendered-in-place like Obsidian) + Source mode + Reading view
- ⬜ `[[wikilink]]` autocomplete (fuzzy note-name suggestions)
- ⬜ `#tag` autocomplete
- ⬜ Headings, bold/italic/strikethrough/highlight (`==mark==`), inline code
- ⬜ Task lists `- [ ]` with clickable checkboxes
- ⬜ Tables, blockquotes, horizontal rules, footnotes
- ⬜ Callouts (`> [!note]`, `> [!warning]`, … — full Obsidian callout set)
- ⬜ Code blocks with language syntax highlighting
- ⬜ Math: inline `$..$` and block `$$..$$` via KaTeX
- ⬜ Mermaid diagrams in ```mermaid blocks
- ⬜ Embeds: `![[Note]]`, `![[Note#Heading]]`, `![[image.png]]`
- ⬜ Autosave (debounced) + optimistic-concurrency conflict detection
- ⬜ Keyboard shortcuts (Cmd+B/I/K, Cmd+Enter checkbox toggle, …)
- 🔮 Vim mode; block references `[[Note^block]]`; drag-line handles

### 2.3 Links & Graph (the crown jewel)
- ⬜ Server-side link extraction on save → `links` table (source, target, unresolved flag)
- ⬜ Backlinks pane ("Linked mentions") per note
- ⬜ Unlinked mentions (plain-text occurrences of note title)
- ⬜ Outgoing links pane
- ⬜ **Global graph view**: force-directed, WebGL-rendered (10k+ nodes at 60fps)
- ⬜ **Local graph** (neighbors of current note, adjustable depth 1–5)
- ⬜ Graph filters: search query, tags, folders, orphans toggle, attachments toggle
- ⬜ Graph groups: color nodes by folder/tag/query
- ⬜ Force sliders: center force, repel force, link force, link distance
- ⬜ Node size by degree (backlink count); hover highlight neighbors; click → open note
- ⬜ Unresolved links shown as ghost nodes; click creates the note (Obsidian behavior)
- ⬜ Graph data cached in Redis, invalidated on note/link write

### 2.4 Organization & Discovery
- ⬜ Tags: inline `#tag` + frontmatter `tags:`, nested tags (`#a/b`), tag pane with counts, click → search
- ⬜ Properties: YAML frontmatter parsed & editable via UI (text, list, number, checkbox, date, links)
- ⬜ Full-text search: Postgres FTS (tsvector + GIN), operators `path:`, `file:`, `tag:`, `line:`, quoted phrases
- ⬜ Quick switcher (Cmd+O): fuzzy note-title jump; creates note if no match
- ⬜ Command palette (Cmd+P): every app command searchable
- ⬜ Bookmarks (star notes/searches/graphs)
- ⬜ Outline pane (heading TOC of active note, click-to-scroll)
- ⬜ Recent files / navigation history (back/forward per pane)

### 2.5 Workflows
- ⬜ Daily notes (configurable date format + template, "Open today's note" command)
- ⬜ Templates (template folder; insert into current note; `{{date}}`, `{{time}}`, `{{title}}` vars)
- ⬜ Note version history (autosnapshot on save, restore) — cheap because server-side
- 🔮 Canvas (freeform whiteboard with cards) — post-v1
- 🔮 Publish (public share links for notes) — post-v1
- 🔮 Real-time collaborative editing (CRDT/Yjs) — post-v1 (architecture must not preclude it)

### 2.6 Workspace UX
- ⬜ Obsidian-style layout: left sidebar (file explorer/search/bookmarks), main editor
  tabs, right sidebar (backlinks/outline/tags), status bar (word count, backlink count)
- ⬜ Tabs: multiple open notes, reorder, close; split panes 🔮
- ⬜ Dark + light themes (Obsidian-quality dark default), theme toggle, system-follow
- ⬜ Resizable/collapsible sidebars; layout persisted per user
- ⬜ Settings modal (account, appearance, hotkeys list, daily notes config, templates config)
- ⬜ Onboarding: new user → default vault with welcome notes demonstrating features

### 2.7 Platform
- ⬜ Auth: email+password signup/login, JWT access (15m) + refresh (7d) rotation,
  logout, sessions table, bcrypt/argon2, rate-limited auth endpoints
- 🔮 Google OAuth (wire like hourly's oauth_connection model)
- ⬜ Profile: name, avatar, password change
- ⬜ API versioned under `/api/v1`, OpenAPI docs at `/docs`
- ⬜ Health endpoints `/health` (deep: db+redis)
- ⬜ Rate limiting middleware (Redis sliding window, per-user + per-IP)
- ⬜ Structured logging + request-id middleware; security headers; CORS

## 3. Architecture (mirrors `hourly` conventions)

```
nodum/
├── tasks/nodum-master-plan.md      ← this file
├── back/                            ← FastAPI backend
│   ├── app/
│   │   ├── main.py                  ← app factory, middleware stack
│   │   ├── settings/{common,dev,production}.py   (pydantic-settings, ENVIRONMENT switch)
│   │   ├── core/{db,redis,logging,openapi,custom_exceptions}.py, middlewares/
│   │   ├── models/{auth,vaults,notes,links,tags,...}/   (SQLAlchemy 2, uuid+timestamp mixins)
│   │   ├── schemas/                 (pydantic v2 request/response)
│   │   ├── api/v1/                  (routers: auth, vaults, notes, links, graph, search, tags, uploads)
│   │   ├── services/                (business logic; ServiceResponse pattern)
│   │   ├── dependencies/{auth,db}.py
│   │   ├── utils/                   (password, pagination, cache, markdown/link parsing)
│   │   └── constants/{enums,limits,defaults}.py
│   ├── alembic/                     (numbered migrations 0001_…)
│   ├── build/Dockerfile.api         (multi-stage: base→development→production, uv, non-root)
│   ├── scripts/{pre-start.sh,lint.sh,format.sh,seed.py}
│   ├── tests/{unit,integration}/
│   └── pyproject.toml + uv.lock
├── web/                             ← Next.js 15 frontend (App Router, TypeScript)
│   ├── docker/Dockerfile            (multi-stage node, standalone output)
│   ├── src/app/                     (routes: landing, login, signup, /vault/[id]/…)
│   ├── src/components/              (editor/, graph/, explorer/, panels/, ui/)
│   ├── src/lib/                     (api client, auth, markdown, stores)
│   └── e2e/                         (Playwright)
├── deploy/
│   ├── docker-compose.yml           (postgres 16 + redis 7.4 + minio + api + web; 127.0.0.1-bound ports)
│   ├── docker-compose.dev.yml / docker-compose.test.yml overrides
│   ├── compose.sh                   (dev|test|prod switcher)
│   └── .env.example                 (NO real secrets, generation instructions in comments)
├── .github/workflows/               (ci-backend, ci-web, alembic-compat)
├── .claude/skills/                  (nodum-backend, nodum-web, nodum-graph, nodum-deploy, nodum-testing)
├── docs/
├── Makefile · README.md · LICENSE(MIT) · CLAUDE.md
```

### 3.1 Data model (core tables)
- `users` (uuid, email uq, password_hash, name, avatar_url, settings jsonb, tier)
- `sessions` (refresh-token sessions, revocable — hourly pattern)
- `vaults` (uuid, user_id fk, name, settings jsonb — daily-note format, template folder…)
- `folders` (uuid, vault_id, parent_id nullable, name, path materialized, uq(vault,path))
- `notes` (uuid, vault_id, folder_id, title, path, content text, content_tsv tsvector GENERATED,
  word_count, properties jsonb (frontmatter), created/updated; uq(vault_id,path);
  GIN(content_tsv); idx(vault_id, updated_at))
- `links` (id, vault_id, source_note_id, target_note_id nullable, target_title text
  (for unresolved), position data; idx both directions) ← powers graph + backlinks
- `tags` (id, vault_id, name, uq(vault,name)) + `note_tags` (note_id, tag_id)
- `attachments` (uuid, vault_id, filename, s3_key, mime, size)
- `note_versions` (note_id, content, saved_at — pruned to last N)
- `bookmarks` (user_id, vault_id, type, target, order)

### 3.2 Scalability decisions
- Async SQLAlchemy + asyncpg; pool 20/overflow 10 per worker; 4 uvicorn workers.
- **Graph endpoint**: single SQL (notes projection + links) → JSON `{nodes:[{id,title,degree,folder,tags}],edges:[[s,t]]}` cached in Redis per vault
  (`graph:{vault_id}`, TTL 300s + explicit invalidation on note write). Payload
  gzip via middleware. Client renders WebGL — server never computes layout.
- **Tree endpoint** cached per vault, invalidated on folder/note structural change.
- **Search**: `websearch_to_tsquery` + `ts_rank_cd` + `ts_headline` snippets; GIN index;
  title trigram index (`pg_trgm`) for quick-switcher fuzzy match.
- Link extraction synchronous in the save request (fast regex parse) — Celery reserved
  for heavy jobs (vault import/export zips, unlinked-mention scans, version pruning).
- Rate limiting via Redis; ETags on heavy GETs; cursor pagination everywhere.
- Frontend: Next.js standalone build, static assets CDN-ready, TanStack Query cache,
  editor loads note content lazily, graph data fetched once + patched incrementally.

### 3.3 Frontend stack
- Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui (Radix)
- **Editor**: CodeMirror 6 (`@codemirror/lang-markdown` + custom live-preview
  decorations, wikilink/tag autocomplete, callout/checkbox widgets)
- **Rendering**: unified/remark/rehype pipeline (remark-gfm, remark-math, katex,
  mermaid, custom wikilink + callout + embed plugins)
- **Graph**: sigma.js v3 + graphology (WebGL, handles 10k+ nodes) with
  graphology-layout-forceatlas2 (web worker); fallback local graph = same stack, filtered.
- State: Zustand (workspace/layout) + TanStack Query (server data)
- cmdk for command palette / quick switcher; Playwright for E2E.

## 4. Delivery Plan — feature branches (git flow style)

Branch model: `main` = prod · `dev` = integration · `feature/*` off dev, merged back via `--no-ff`.

| # | Branch | Scope | Status |
|---|--------|-------|--------|
| 0 | (main) | repo init, README, LICENSE, .gitignore, this plan | ✅ |
| 1 | feature/scaffold | back/ + web/ + deploy/ skeletons, Dockerfiles, compose files, compose.sh, Makefile, .env.example, CI stubs | ✅ |
| 2 | feature/backend-foundation | (folded into scaffold) settings, db, redis, logging, middlewares, exceptions, health | ✅ |
| 3 | feature/auth | users+sessions models, signup/login/refresh/logout/me, JWT rotation, tests | ✅ |
| 4 | feature/vaults-notes | vaults/folders/notes CRUD, tree endpoint, default-vault onboarding seed, tests | ✅ |
| 5 | feature/links-graph | link parser, links table sync on save, backlinks/outgoing endpoints, graph endpoint + Redis cache, tests | ✅ |
| 6 | feature/search-tags | FTS + quick-switcher endpoints, tag extraction + tag endpoints, tests | ✅ |
| 7 | feature/attachments | MinIO presigned upload/download, attachments CRUD | ✅ |
| 8 | feature/web-foundation | Next.js scaffold, Tailwind+shadcn, api client + auth flow (cookie refresh), landing/login/signup, app shell layout | ✅ |
| 9 | feature/web-obsidian-ui | REWRITE (user feedback): pixel-faithful Obsidian workspace — ribbon, explorer, tabs, panels, switcher, status bar | ✅ |
| 10 | feature/web-editor | CM6 editor, live preview, autocomplete, reading view, autosave | ✅ |
| 11 | feature/web-graph | global + local graph views with filters/groups/sliders | ✅ |
| 12 | feature/web-search-palette | (folded into web-obsidian-ui + command-palette) | ✅ |
| 13 | feature/daily-templates | daily notes, templates (bookmarks/version-history → Phase B) | ✅ |
| 14 | feature/import-export | vault zip import (Obsidian-compatible), export | ✅ |
| 15 | feature/e2e | Playwright suite (18 tests) + ci-e2e workflow | ✅ |
| 16 | feature/docs-skills + prod-readiness | audit fixes, prod verification, docs, project skills | ✅ |

**Definition of done (v1): ✅ MET 2026-08-12.** Dev stack boots; signup → default
vault → linked notes → backlinks → GPU graph → search + switcher + palette →
Obsidian zip import/export → 42 backend + 18 Playwright tests green → prod
compose verified end-to-end (signup→graph→export through the prod proxy) →
gitleaks clean → pushed to github.com/vorreix/nodum. Released as v1.0.0.

## 5. Conventions (from hourly — follow strictly)
- Conventional commits (`feat:`, `fix:`, `chore:`…) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Backend: uv + ruff + numbered alembic revisions (`0001_…`); ServiceResponse pattern;
  routers thin, services fat; loopback-only port binds in compose; non-root containers.
- API responses: `{"data": …}` envelope, errors `{"error": {"code","message"}}` (hourly conventions doc).
- Never commit `.env` — only `.env.example` with placeholder values + generation commands.

## 6. Progress Log

- **2026-08-21 (the public API: scoped keys, REST surface, Scalar reference)** —
  Nodum now has a third door beside the app and MCP: a public REST API at
  `/api/public/v1` for programs users write, authenticated by `nodum_key_…`
  API keys minted in Settings → API keys with coarse scopes
  (read / write / delete / ai). The keys share the `api_tokens` table (kind
  `"key"`, migration `0020` adds `scopes`), the 10-per-kind cap, the
  password-change/reset revocation and the per-token rate-limit bucket with
  MCP tokens; `verify_token` now returns a `TokenIdentity` and scopes are
  enforced only in the sub-app's dependency — services stay unrestricted for
  the session path. The surface is 20 endpoints: vaults, tree, notes CRUD
  (append/prepend below frontmatter, optimistic 409 with
  `server_updated_at`), paginated list/search (`total` via a window count),
  quick-switch, link and **unlink** (new `remove_wikilinks` splices matching
  `[[links]]` out of the markdown — embeds, code and frontmatter protected),
  backlinks, unlinked mentions, tags (nested via a `:path` param), graph +
  local graph, attachments, and `POST …/ai/ask` over the stored credential.
  It is a separate FastAPI app mounted on the main one — own OpenAPI document
  (only public endpoints, `ApiKey` bearer scheme, servers pinned to the
  mount), own exception handlers (a mount inherits middleware but not
  handlers), no lifespan. The reference docs are the OpenAPI document
  rendered by Scalar (`@scalar/api-reference-react`, bundled — no CDN) at
  `/api-reference`, try-it client included: verified live by pasting a key
  into its Auth box in a browser and watching `GET /vaults` return 200
  through the Next proxy. Settings → API keys hands the user a ready-made
  curl with their fresh key filled in; `docs/api` is the human article;
  `deploy/smoke.sh` gained a mint-call-revoke step. Caddy needed nothing —
  `/api/*` already covers the mount. Tests: `test_api_keys` (cap is
  per-kind), `test_public_api` (only keys authenticate — sessions and MCP
  tokens 401 here and keys 401 at `/api/v1/mcp`; scopes 403 by name;
  cross-tenant 404s that never echo content; the OpenAPI document leaks no
  internal path and padlocks every operation), unit tests for scope
  defaulting and wikilink removal, and an e2e that drives the vault over
  REST with a key minted through the UI. Two inherited breakages in the
  docs-screenshot pipeline fixed in passing: it opened "Home" through the
  virtualized explorer (not in the DOM when scrolled away — now via ⌘O), and
  its AI stub predated streaming (now answers SSE when `stream: true`).

- **2026-08-19 (account recovery and closure)** — Three flows now hang off the
  signup OTP work: forgotten-password reset, password change from settings
  (the endpoint and UI already existed — it needed coverage, not code), and
  account deletion behind its own emailed code.
  `email_verifications` gained a `purpose` column, and every lookup is scoped
  by it, so the code sitting in an inbox from signing up cannot be spent on a
  password reset — the purpose is mixed into the HMAC too, belt and braces.
  Reset drops every session that existed before it: a reset is what someone
  does when they suspect they have lost control of the account, so leaving the
  intruder's refresh token alive would defeat the exercise. It also marks the
  address verified, since reaching a mailed code proves the mailbox as surely
  as signup does.
  Deletion is *not* gated on the password as well as the code: accounts made
  through Google sign-in carry a random password their owner has never seen
  (oauth_service mints one), so requiring it would lock exactly those people
  out of closing their own account. It purges each vault's S3 prefix before
  the row goes, because a DB cascade cannot reach into the bucket and orphaned
  attachments are precisely what someone closing an account expects to be
  gone; the purge is best-effort so a sulking bucket cannot strand a
  half-deleted account.
  9 new backend tests + 3 new e2e; 171 backend and the full e2e suite green.
  Note for later: the one-shot backend failure seen mid-run was Redis still
  coming up with Docker, not a regression — two clean runs after.

- **2026-08-19 (smoke.sh caught up with verification)** — The first production
  deploy reported `✗ signup failed: {"status":"verification_required"…}`. The
  deploy was healthy: that 201 proves the API answered, the user and code rows
  were written, and a provider *accepted the message* (signup 502s when the
  whole chain refuses). What was stale was `smoke.sh`, which read
  `data.access_token` straight out of the signup response — a contract the
  verification work changed and I did not follow through to this script.
  It now authenticates three ways: `SMOKE_EMAIL`/`SMOKE_PASSWORD` logs in to an
  existing account (the right choice for production — creates nothing, sends
  nothing); otherwise it signs up, and if verification is required it finishes
  the step in the stack's own Postgres, since the code is stored as an HMAC and
  cannot be read back. Run away from the deploy host that last path cannot
  work, so it says so and names the fix instead of failing obscurely.
  Worth remembering: the throwaway signup mails a real code to
  `smoke-*@nodumtest.dev`, a domain that does not exist, so every unattended
  run is a hard bounce charged against the sending reputation the feature
  depends on. The script and docs/deploy.md now say so at the point of use.

- **2026-08-17 (email verification, and the auth panel's three left edges)** —
  Signups now prove the mailbox: a six-digit code, stored as an HMAC of itself
  (six digits is a 10^6 space, so a bare digest is a lookup table — the app
  secret is what makes a dump useless), five attempts per code, one pending
  code per user, 60-second resend cooldown. Login refuses an unverified
  account with `email_not_verified`, which the web client turns into the code
  screen rather than a dead end. Google OAuth already trusted Google's own
  `email_verified`, so it is unaffected.
  Delivery walks an ordered provider chain — Brevo → Mailjet → Resend →
  Mailgun → any SMTP relay. The chain is the point: a quota rejection is
  indistinguishable from an outage (both are just an error response), so
  listing several providers survives one having a bad hour *and* stacks their
  free tiers. Researched 2026-08: Brevo 300/day with no expiry is the largest
  sustained free tier, Mailjet 6k/month (200/day), Resend 3k/month, Mailgun
  100/day; SendGrid retired its free plan and Mailchimp Transactional never
  had one, which is why neither is wired up.
  Environment split, as asked: production issues a random code and must mail
  it; everywhere else issues the fixed `EMAIL_OTP_DEV_CODE` (123456) and mails
  nothing, so the flow has the same shape in dev and is exercisable without a
  mailbox. `EMAIL_VERIFICATION_REQUIRED` defaults on; production *refuses to
  boot* with it on and no provider configured, since the alternative is
  silently locking every new signup out of its own account. Migration 0016
  also marks pre-existing users verified — otherwise switching this on logs
  out everyone who signed up before it existed.
  The pytest suite runs with the flag off (fifteen files sign up for a token
  and would gain an OTP dance covering nothing); `test_email_verification.py`
  turns it back on for its six cases, and `test_email_providers.py` covers the
  chain's order, skipping and total-failure behaviour without a network.
  Also fixed the auth brand panel: the wordmark sat at the panel padding, the
  knot centred itself, and the footnotes sat at the padding again — three left
  edges, which is what made the mark look adrift. One shared measure now holds
  all three.
  162 backend tests, `make verify`, and the full e2e suite green (the shared
  `signupFreshUser` helper types 123456 when the code step appears, so every
  spec exercises the new flow).

- **2026-08-16 (public face: landing + auth)** — nodum.md was a shadcn card
  stack with a hand-drawn SVG placeholder for a mark; the actual logo (a 3D
  torus knot, magenta→violet→azure on black) only ever appeared 48px tall on
  the login card. The three public routes now live in an `app/(marketing)`
  route group with their own skin (`marketing.css`), where every colour is
  sampled from that render and the knot is the hero at up to 23rem, lit by a
  slow conic aurora and tilted a few degrees under the pointer — the light
  moves, never the render, because spinning a rendered object reads as a
  spinning photograph. Type is Bricolage Grotesque over Instrument Sans, with
  Geist Mono carrying the product's own vernacular (`[[Note]]`, `#tag`,
  `![[image.png]]`) in a strip under the hero. The mid-page product shot is a
  real screenshot of a seeded vault, not a mockup, and it happens to show the
  folder-colour work from earlier today. Auth is a two-up: brand panel left,
  form right, dropping to knot-over-form on phones.
  Two accessibility fixes fell out of building it: the gradient button failed
  4.5:1 both ways (dark text on the indigo stop, white on the magenta) so
  buttons use a deepened strand with white type, and `--mk-faint` was lifted
  to #8a86a0 since it carries the eyebrows and captions. Reduced motion is
  respected without hiding anything (verified: 20 animated elements, 0 left
  under-opacity). Gotchas worth remembering: sips writes AVIF that Chromium
  decodes to the right dimensions but paints blank when the source is opaque
  — the knot (with alpha) is fine, the screenshot ships as JPEG; and a
  password-reveal button labelled "Show password" makes
  `getByLabel("Password")` ambiguous, which is how the whole auth e2e reaches
  that field, so it is labelled "Show characters".
  New `e2e/landing.spec.ts` asserts both images actually decode; auth suite
  green; `make verify` green.

  **Follow-up the same day** — the repo links pointed at the old
  `vorreix/nodum`; every one of them (README, `app-meta.ts`, the marketing
  pages) now points at `nodummd/nodum`, which is what `origin` actually is.
  And the static workspace shot became a *working* miniature: `DemoVault`
  runs the real @cosmos.gl/graph engine over a 21-note vault beside a small
  explorer, so recolouring a folder recolours its nodes on the landing page
  itself, and hovering a file picks its node out of the graph. The engine is
  dynamically imported on scroll-into-view, so the first load still pays
  nothing for WebGL; reduced motion and any WebGL failure fall back to the
  screenshot.
  Framing that demo took three wrong turns worth recording: `fitView()` frames
  the whole 4096² field, not the points; `getPointPositions()` returns the
  *seeded* layout, not the settled one (`getTrackedPointPositionsMap()` is the
  live truth); and the `scale` argument of `setZoomTransformByPointPositions`
  is not an absolute zoom — `setZoomLevel` afterwards is what lands it. The
  fit therefore measures px-per-unit from the engine's own projection and
  corrects itself over a couple of passes, after the simulation is parked
  (fitting a still-cooling layout drifts small as the centre force pulls the
  cloud in). Worth reusing if the app's own fit is ever revisited.

- **2026-08-16 (explorer colours reach the graph)** — Colouring a folder in
  the explorer only ever repainted the tree; the graph kept every node grey,
  because the canvas coloured from `settings.graph.groups` alone and never
  looked at `settings.itemColors`. Both now share one rule in
  `lib/graph/item-colors.ts`: colour on the note > matching graph group >
  colour inherited from the folder chain, so a folder paints everything under
  it while a note-level pick overrides it. Nodes are matched to folders by
  path (`GraphNode.folder` and `folders.path` are the same string server-side),
  so no id plumbing was needed; the tree query supplies the paths and the
  vaults query the colours, both already-warm cache entries. The compact
  side-panel graph now reads the vault too (it shared the cache in practice
  anyway) so local graphs colour identically. Hex→rgba parses are memoised —
  toRgba spins up a canvas per call and it now runs per node. Moving a note
  invalidates the graph query, since a move changes which folder colour it
  inherits. Verified on the canvas, not just in the DOM: folder red painted
  both notes, then colouring one blue moved only that node, layout untouched.
  New e2e in graph.spec.ts covers both directions; graph/hover/incremental/
  appearance suites and `make verify` green.

- **2026-08-15 (session restore)** — Found the last hole in reveal-on-
  navigate by smoke-testing the app the way a user starts it: reload the
  page. Every route highlights the open file EXCEPT opening the app. The
  subscription only fires on a transition, and a session restored from the
  persisted workspace has the note already active — no transition, no
  reveal. In a large vault the row is then scrolled well outside the
  virtualized window, so the explorer shows no selection at all.
  Now reveals once on mount, waiting for the tree query, deferred out of
  the effect body so the state update lands in a frame callback.
  Verified live: after a reload the demo vault scrolls to "Functional
  Programming" (scrollTop 3238) and selects it, where it previously showed
  nothing. The e2e builds a tree tall enough for virtualisation to drop the
  row, and fails when the initial reveal is removed.
  120 e2e green; autosave re-confirmed against postgres.

  The four mandate items are complete and every command, route and
  interaction named in their specs has been executed under test. The
  recurring /loop job for this mandate was cancelled — see the session
  notes; further iterations would be inventing scope.

- **2026-08-15 (scroll + retraction)** — Closed the last unverified half
  of the reveal spec and retracted a speculative change.
  - *"Scrolling the virtualized row into view" had never been checked* —
    the assertions only required the row to be in the DOM. Verified live
    in the demo vault: 5892px of tree against an 870px viewport, scrolled
    to the top, reveal moved `scrollTop` to 3238 and put the row inside
    the viewport. Now covered by an e2e that builds a tree tall enough for
    virtualisation to have dropped the target row entirely, then asserts
    its rect sits within the scroll container's. Confirmed the test FAILS
    when `scrollToIndex` is removed, so it is not vacuous.
  - **Reverted the quick-switcher Enter guard from the previous session.**
    It was written from a code-reading hypothesis: that while the
    debounced search is in flight nothing matches, so "Create …" becomes
    the highlight and Enter creates a duplicate. Three attempts to
    demonstrate it — through the UI, through synthetic events, and with
    the debounce widened tenfold AND the guard removed — all showed Enter
    opening the correct note and creating nothing. The reasoning was
    wrong: for an empty debounced query the result set is the RECENTS
    list, not `undefined`, so the exact-match test has real data and the
    fallback chain never misfires. No change beats a speculative one.
  - 119 e2e green; autosave re-confirmed against postgres.

  All four mandate items (editor context menu with active state, note ⋯
  menu, breadcrumb, reveal-on-navigate) are implemented, and every
  command and route named in their specs has now been executed at least
  once under test.

- **2026-08-15 (command audit)** — Same treatment for items 1 and 4 that
  the ⋯ menu got: execute everything, don't trust that it renders.
  - *Eleven formatting commands had never been run* (strikethrough,
    highlight, inline code, code block, link, horizontal rule, bullet /
    numbered / task list, blockquote, callout). All eleven work. They are
    now driven through the menu and asserted against raw markdown in
    `editor-commands.spec.ts`, plus Select all — which has to be proved by
    ACTING on the selection, because `drawSelection()` paints CodeMirror's
    own layer and leaves the native selection empty.
  - *Reveal-on-navigate had only been checked for wikilinks.* Quick
    switcher and back/forward are covered by e2e now. The graph route —
    the risky one, since it opens the note in the OTHER pane — was
    verified live: clicking a node opened "Functional Programming" and the
    explorer expanded Topics > Computer Science and selected it.
  - **Fixed: revealing a FOLDER opened its ancestors but not the folder
    itself**, so a breadcrumb crumb scrolled to a closed folder showing
    none of its contents. A note reveals by opening the folders above it;
    a folder must also open itself.
  - Hardened the quick switcher's Enter: while the 150ms-debounced search
    is in flight nothing matches, so the "Create …" row becomes the
    highlight and Enter would create a DUPLICATE of the note being jumped
    to. Enter now resolves the query first. Found by reading the code —
    the window is shorter than Playwright's per-action overhead and I
    could not reproduce it with automation, so this is a guard rather
    than a fix for an observed failure.
  - 118 e2e green; autosave re-confirmed against postgres.

- **2026-08-15 (audit)** — Went back over the note ⋯ menu and exercised
  every entry instead of only checking that it rendered. Four were
  broken and one was a data-loss path.
  - *Find… and Replace… were the same command* (both `openSearchPanel`)
    and neither left the caret in a field: Radix restores focus to the
    trigger on close, landing AFTER our own `focus()`. They now claim
    focus through `onCloseAutoFocus` and target their own input.
  - *Add file property / Find / Replace did nothing in Reading view*,
    which mounts no CodeMirror at all — live-looking items that weren't.
    They switch to the editor and wait for it to mount.
  - *Rename…* lost the same focus race.
  - *Export to PDF…* had no print stylesheet, so it printed the
    explorer, ribbon, tab strip and panels. Now scoped via
    `@media print` + `data-print-root`, and it switches to Reading view
    first because CodeMirror only builds lines near the viewport —
    printing from the editor truncated long notes.
  - **Merge left the open editor on the PRE-merge body.** The draft is
    seeded once at mount and keyed by note id, so an API write never
    reached it; the next keystroke would autosave the stale text back
    over the merge. `EditorBody` now adopts externally-replaced content
    via a query-cache subscription (guarded against unsaved keystrokes
    and against collab, which has its own reset channel). This also
    covers import and the clipper writing into an open note.
  - Verified live: Replace → replace field focused, Find → search field;
    Find from Reading view switches to Live preview and opens the panel;
    print rules hide the explorer and show the note (measured via
    computed visibility); Export calls print exactly once, in Reading
    view; merge appears in the open editor immediately. Autosave
    re-confirmed against postgres. 103 e2e green.

- **2026-08-15 (later)** — Editor context menu now reports ACTIVE STATE.
  Bold/Italic/Underline/Strikethrough/Highlight/Inline code, the six
  heading levels and the list & quote toggles render as
  `menuitemcheckbox` with `aria-checked`, so the state is exposed to
  assistive tech and assertable in tests rather than just drawn.
  Detection reads the syntax tree (`activeFormats`), because the caret
  normally sits INSIDE `**bold**` and a marker-matching check would call
  that unformatted. It resolves on BOTH sides of the caret and unions:
  a `.cm-line` spans the full editor width, so clicking the empty space
  right of `## Heading` leaves the caret at end-of-line with the heading
  only on its left, and a one-way resolve called it plain text.
  Verified live against the demo vault (bold run -> Bold checked;
  `## Related` -> Heading 2 checked; bullet line -> Bullet list checked)
  and covered by two new e2e cases. Autosave re-confirmed against
  postgres, and a REST save was observed propagating into the open
  editor with no reload — the `sync_room` fix working end to end.
  95 e2e green.

- **2026-08-15** — Editor menus, breadcrumb, reveal-on-navigate; three
  data-integrity bugs fixed underneath them.
  - *Right-click menu in the editor*: Format (bold/italic/underline/
    strikethrough/highlight/sup/sub/code/clear), Text colour + Highlight
    colour palettes, Paragraph H1–H6, Lists (+indent/outdent/checkbox),
    Insert (link/wikilink/embed/tag/table/rule/footnote/math/mermaid/
    date/time), 13 callout types, Table row/column/align/sort/format, line
    sort & dedupe, Properties, Find. Underline and colour emit inline HTML —
    markdown has no syntax for either, and that is what Obsidian emits too.
    Right-clicking moves the caret to the pointer (unless inside a
    selection) and works on rendered block widgets, so table commands are
    reachable from a table you can see. Fixed three latent `toggleWrap`
    bugs the menu made trivially reachable: selecting the markers
    double-wrapped (`****bold****`), italic inside bold stole a star and
    demoted it, and wrapping a select-all range swallowed the newline.
  - *Note ⋯ menu* (top right): backlinks in document, reading/source view,
    split right/down, open in new window, rename, move file to…, bookmark,
    merge entire file with…, add file property, export to PDF, find,
    replace, copy path, version history, linked view, reveal in navigation,
    delete. Reveal-in-Finder / open-in-default-app stay omitted (desktop).
  - *Breadcrumb* centred above the editor: folder crumbs reveal that folder
    in the explorer; the last crumb renames the note in place.
  - *Reveal on navigate*: opening a note by ANY route (wikilink, graph,
    palette, backlink) expands its folders and scrolls the explorer row into
    view. Driven by a store subscription so the state update happens in an
    event, not during render.
  - **Collab was broken, silently.** Yjs updates fanned out over
    `redis_control`, which has `decode_responses=True` — every binary update
    raised `'utf-8' codec can't decode byte 0x9e` and killed the
    subscription. Worse, a room seeded before a REST save kept serving the
    OLD body to every client that connected and would persist it back over
    the save: the note reverted. Rooms now adopt REST writes
    (`collab_server.sync_room`, cross-worker over `collab-reset:{room}`), and
    `CollabServer` is restartable (`stop()` latched its events, so a second
    `startup()` returned a server whose rooms could never start).
  - **Concurrent refresh logged users out.** The refresh grace marker was
    published AFTER the rotation committed; in between, the old JTI existed
    in neither the session table nor Redis, so a racing refresh tripped the
    stolen-token defence and invalidated every session for that user. This
    was also the cause of the e2e suite's chronic flakiness — after the fix
    the editor/note-menu suites went from 4 flaky in 2.7min to 0 in 35s.
  - e2e: `editor-context-menu.spec.ts` (9) and `note-menu.spec.ts` (7);
    backend regression tests for the grace ordering and for a REST save
    surviving a live room. 93 e2e + 90 backend green.

- **2026-08-14 (post-v3.2.0)** — Two user-reported gaps fixed: (1) there
  was NO visible settings entry point — added an Obsidian-style Settings
  gear to the left ribbon (above Log out) + a gear in the mobile top bar
  (⌘, and ⌘P remain keyboard escape hatches). (2) Tab drag-and-drop now
  feels like VS Code — a live insertion caret (accent line) shows exactly
  where the tab will land as you drag over a strip, the dragged tab fades,
  and the cursor is grab/grabbing. e2e: settings-gear opens the window;
  tab-dnd specs still green.

- **2026-08-14** — Phase F fully executed → **v3.2.0** (Obsidian-grade
  workspace, graph & settings; driven by a 5-agent investigation whose
  per-area plans are persisted in the phase-f-plan workflow output):
  adjustable split-pane divider (S13.1); Obsidian-style graph controls
  — floating gear popover + reset-to-defaults (S14.1); graph animation
  polish — node/link fade-in, eased settle, a setConfigPartial
  correctness fix, hover ring (S14.2); the full Obsidian settings
  taxonomy — Interface tab, validated font pickers, expanded General/
  Appearance/Files & links (S15.1); user-choosable canvas background
  dots/grid/blank (S15.2); and scoped tab drag-and-drop — reorder, move
  between panes, edge-split side-by-side/stacked (S13.2). Deferred to
  the Icebox: the full recursive split-tree for simultaneous 2×2 tab
  nesting (a panes[]→tree swap + v3→v4 persist migration judged too
  risky to land unattended). Suites: 81 backend + 75 e2e.

- **2026-08-13 (post-v3.1.0, 4)** — Command palette raised (top 15%,
  centered) and filled out with the full Obsidian-style command set
  (~55 commands): duplicate file, copy file path, bookmark / bookmark
  all tabs, new canvas, new folder, create-note-to-the-right, go-to-tab
  #1–8 / last, close/focus tab group, show backlinks/outgoing/outline/
  tags/local-graph (right sidebar), toggle ribbon, zoom in/out/reset,
  toggle default new-tab mode, reload. Store gained rightPane/setRightPane
  (right sidebar pane lifted from local state), ribbonVisible/toggleRibbon,
  and a generalized closePane. Genuinely N/A on web and left out (noted):
  themes/light-dark, sync, bases, stacked tabs, split-down, multi-window,
  Finder/OS reveal, canvas image export, move-to-folder picker (backend
  ready, needs a picker UI). e2e: palette-commands spec covers duplicate,
  new canvas, outline panel, zoom, ribbon.

- **2026-08-13 (post-v3.1.0, 3)** — Command palette restyled to match
  Obsidian's: alphabetical flat list (no group heading, no per-row
  icons), "Category: action" labels, "Select a command…" placeholder,
  a trailing × dismiss button, a wider (720px) window, and a footer
  hint bar (↑↓ navigate · ↵ use · esc dismiss). CommandInput gained
  opt-in `showSearchIcon` / `onClose` props so the quick switcher keeps
  its own look. e2e updated for the new placeholder + labels.

- **2026-08-13 (post-v3.1.0, 2)** — Obsidian-style hotkeys: tab
  navigation commands (go to next/previous tab, ⌘1–8 to tab N, ⌘9 to
  last, close all other tabs, toggle pin) + editor-pref and sidebar-pane
  toggles, all runnable from the command palette (the browser-proof
  path) and bound to keys where safe. The Hotkeys settings tab is now a
  grouped, searchable reference of all 50 commands in a wider (1040px)
  Obsidian-like window; palette-only commands show a ⌘P chip. Note:
  browser-reserved chords (⌘W, ⌘1–9) fire in the installed PWA /
  standalone window; in a normal browser tab the command palette is the
  reliable path. e2e: tab-hotkeys + settings-bookmarks specs.

- **2026-08-13 (post-v3.1.0)** — Tab keyboard UX: ⌘/Ctrl+W closes the
  active tab reliably (works in the installed PWA / standalone window;
  browser tabs still reserve the chord). Closing the active tab now
  activates its neighbor (right, else left) instead of jumping to the
  rightmost, and a key-repeat guard stops a held ⌘W from nuking a burst
  of tabs. Pinned tabs stay protected. e2e: e2e/tab-hotkeys.spec.ts.

- **2026-08-13 (later)** — Phase E fully executed → **v3.1.0** ("the
  Obsidian feel", driven by a live CDP study of Obsidian 1.13.7 —
  docs/research/obsidian-study-2.md): incremental never-jumping graph
  engine (persistent positions, neighbor-seeded insertions, settled-sim
  freeze, camera restore) + graph panel parity (search, arrows, node
  size, link thickness, link force); Obsidian-style tabbed settings
  window with working options — editor prefs (default view mode,
  readable line length, line numbers, spellcheck, font size), accent
  colour, default new-note location (backend folder_path create),
  confirm-before-delete, page-preview modifier toggle, searchable
  hotkeys reference. Google OAuth verified live with real credentials;
  logo integrated (app icons, PWA, README). Suites: 81 backend + 56 e2e.

- **2026-08-13** — Phase D fully executed → **v3.0.0**: block references,
  split panes, pinned tabs + nav history (v2.1.0); mobile workspace, PWA +
  share-target clipper (v2.2.0); Google OAuth, whole-vault publishing
  (v2.3.0); Canvas MVP (JSON Canvas), graph time-travel replay, importer
  attachments + .obsidian mapping (v3.0.0). Also fixed a collab reconnect
  duplication bug found in live verification. Suites: 80 backend + 48 e2e.
  Owner-side setup steps: docs/OWNER-SETUP.md.

- **2026-08-12 (evening)** — Backlog fully executed: Sprint 1 hardening,
  Sprint 2 parity core → **v1.2.0**, Sprint 3 polish (graph groups, nested
  tags, page preview, editable properties, hover dim), Sprint 4 scale & ops
  (payload caps, scan bounds, Redis control-plane split, Sentry, deploy +
  backup docs), Sprint 5 live collaboration (Yjs + pycrdt, presence,
  persistence) → **v2.0.0**. Suites: 68 backend + 39 e2e. Working checklist:
  tasks/nodum-backlog.md.
- **2026-08-12**: Project started. Analyzed hourly reference (backend layering,
  compose patterns, Dockerfile.api). Wrote this plan. Next: git init + push,
  research workflow (Obsidian deep-dive + library validation), then feature/scaffold.
- **2026-08-12 (b)**: Scaffold + auth + vaults/notes shipped to dev. Research
  workflow finished → `docs/research/` (6 specs + DECISIONS.md). Key library
  decisions: CM6 with in-repo live-preview decorations (SilverBullet patterns);
  reading view react-markdown + @portaljs/remark-wiki-link + rehype-callouts +
  katex + client-side mermaid + shiki; graph = @cosmos.gl/graph 3.4.0 (NEVER
  @cosmograph/* — CC-BY-NC license); Next 16.3 already generated (read
  node_modules/next/dist/docs before frontend work); auth pattern = Next
  rewrites /api/* → FastAPI so refresh cookie is first-party.
  Infra note: nodum dev ports remapped (pg 15432, redis 16379, minio 19000/1)
  to coexist with the hourly stack. Tests: 13 passing (auth 8, vaults 5).
  Next: feature/links-graph (link extraction, backlinks, graph endpoint).
- **2026-08-12 (c)**: BACKEND v1 API COMPLETE — links/graph (wikilink parser,
  backlinks+snippets, unlinked mentions, cached whole-vault graph, local BFS
  graph), search (weighted tsvector + GIN, operators path:/file:/tag:,
  ts_headline marks, pg_trgm quick switcher), tags (synced tables, nested
  matching, tag pane counts), attachments (MinIO, ![[embed]] resolution).
  35 tests green · migrations 0001-0005 · all merged to dev & pushed.
  NEXT: frontend phase — feature/web-foundation (api client + auth + shell,
  Next 16: READ web/AGENTS.md + node_modules/next/dist/docs first, add
  /api/* rewrite → localhost:8000 so refresh cookie is first-party), then
  web-vault-ui → web-editor → web-graph → web-search-palette. Use
  docs/research/DECISIONS.md package versions. Consider parallel subagents
  for independent component groups after the foundation lands.
- **2026-08-12 (d)**: feature/web-foundation SHIPPED & BROWSER-VERIFIED —
  /api/* rewrite proxy (first-party cookie auth), api client (in-memory token,
  single-flight refresh), typed endpoints for all resources, zustand stores
  (auth bootstrap + persisted workspace), shadcn radix-nova, landing/login/
  signup/vault pages. Live test: signup → welcome vault tree renders; session
  survives reload. Dev servers: API uvicorn :8000, web dev :3100 (3000 taken
  by unrelated process). NEXT: feature/web-vault-ui (Obsidian layout: file
  explorer + tabs + panels + settings + themes) then feature/web-editor
  (CM6 live preview per docs/research/editor-stack.md), then graph.
- **2026-08-12 (e)**: USER FEEDBACK: disliked first UI. Installed design
  skills (.claude/skills/: frontend-design, web-design-guidelines,
  composition-patterns, react-best-practices, ui-ux-pro-max, ui-styling —
  gitignored as vendored). COMPLETE UI REWRITE → feature/web-obsidian-ui:
  exact Obsidian dark palette (base-scale vars, purple accent), ribbon,
  explorer w/ context menus, tabs, editor pane w/ autosave, right panels
  (backlinks/outgoing/tags/outline), search pane, ⌘O switcher (async-safe
  cmdk highlight — NOTE: cmdk Enter needed manual onKeyDown handler),
  status bar. Browser-verified end to end. Dev rate limiting disabled
  (dev/test envs) after 429s from per-keystroke queries.
  KNOWN ISSUE (P2): rapid concurrent refreshes can trip the token-reuse
  defense and kill sessions — add ~30s grace for the previous refresh JTI.
  UI RULE GOING FORWARD: match Obsidian exactly; Lucide icons only (no
  emoji); tokens from globals.css only (no raw hex in components).
  NEXT: feature/web-editor — CM6 live preview (this makes note content
  render like Obsidian: hidden syntax, wikilink pills, checkboxes, callouts);
  then feature/web-graph (@cosmos.gl/graph).
- **2026-08-12 (f)**: feature/web-editor SHIPPED & BROWSER-VERIFIED. CM6
  live preview (custom Lezer nodes for wikilinks/embeds/tags/highlights,
  reveal-on-cursor, checkbox widgets, click-to-follow + create-on-ghost-click
  with instant backlink resolution, [[..]] and # autocomplete), source mode,
  reading view (KaTeX math renders, frontmatter stripped, wikilink nav).
  All 35 backend tests green; web lint+build clean.
  Live-preview gaps deferred (acceptable): math/mermaid widgets in live
  mode, table widget, properties UI, callout icon/color variants.
  NEXT: feature/web-graph — @cosmos.gl/graph GPU graph view (global + local,
  filters/forces per docs/research/obsidian-graph-spec.md), then Playwright
  e2e + daily notes/templates + import/export + prod compose verification.
- **2026-08-12 (g)**: feature/web-graph SHIPPED & BROWSER-VERIFIED. cosmos.gl
  GPU graph: nodes sized by degree, ghost nodes, click-to-open + ghost-click
  creates note, hover tooltip+ring, HTML label overlay (tracked positions,
  zoom fade), filters + force sliders, CSS-variable colors, fitView framing
  (points must seed around space center 2048 — camera gotcha). Graph tab via
  ⌘G. MINOR BUGS NOTED: (1) reading-view wikilink preprocessor converts
  [[..]] inside inline code (regex runs pre-parse); (2) local graph not yet
  surfaced in right panel (props ready).
  REMAINING FOR v1 DoD: Playwright e2e suite · daily notes + templates ·
  bookmarks · vault import/export (Obsidian zip) · command palette content
  (⌘P currently opens empty switcher state) · prod compose full-stack boot
  check · README/docs polish · project skills (.claude/skills/nodum-*).

## 7. Research Notes
_(filled by research workflow — Obsidian behavioral details, library decisions)_

- **2026-08-12 (h): v1.0.0 RELEASED.** Phase A complete: audit fixes (23
  confirmed findings), command palette, callouts, daily notes + templates,
  Obsidian import/export, prod compose verified end-to-end, CI e2e, session
  pruning, README + 4 project skills (.claude/skills/nodum-*). dev merged to
  main and tagged v1.0.0. Next: Phase B (embeds, properties UI, live-preview
  math/tables, virtualization) and Phase C differentiators — see
  tasks/nodum-audit-and-roadmap.md §6.

- **2026-08-15: Navigation, explorer parity, attachments, import, plugins,
  clipper.** Three-phase mandate delivered and verified live.
  - *Navigation*: per-pane back/forward arrows in every tab strip. Fixed three
    latent bugs — closeTab never pruned history (Back appeared dead after a
    close), navigateBack targeted the active pane not its own, and CodeMirror's
    defaultKeymap bound Mod-[ / Mod-] to indent so the chord both indented and
    navigated.
  - *Explorer*: Obsidian-parity context menu (open in new tab / to the right /
    new window, duplicate, move, bookmark, merge, copy path, version history,
    rename, delete), item colours inherited down the folder tree
    (vault.settings.itemColors), and tag assignment via a new
    PATCH /notes/{id}/tags that edits YAML frontmatter server-side.
    Reveal-in-Finder / open-in-default-app deliberately omitted (desktop only).
  - *Attachments*: paste + drag-drop upload inserting an embed at the cursor,
    hover preview cards (images inline, PDFs scrollable). Security: 5MB cap,
    extension-driven canonical MIME with magic-byte verification, no .svg/.html,
    inline disposition only for safe types.
  - *Import*: root-unwrapping (a normally-zipped vault nested everything one
    level deep and broke every path-style wikilink — resolution went 1/5 -> 4/5),
    .obsidian config detected by suffix, .txt/.markdown as notes, PDFs as an
    attachment plus a note of their extracted text (pypdf), and direct folder
    import via POST /vaults/{id}/import-files.
  - *Plugins*: capability-scoped API in an opaque-origin iframe
    (sandbox="allow-scripts", no allow-same-origin; connect-src 'none'), host-side
    permission checks, registry UI in Settings. Obsidian-plugin compatibility
    assessed honestly: 0-5% unmodified drop-in, 12-18 engineer-months for 20-35%
    partial — recommend never promising it.
  - *Web Clipper*: scoped clipper tokens (hashed, note-create only, revocable
    without touching the session), POST /clipper/clip with frontmatter
    provenance, and an MV3 extension under clipper/.
  - Graph also gained an Obsidian-grade layout pass, richer interactions, and a
    guard so a failed WebGL context can no longer take down the workspace.

- **2026-08-19: First run, docs, MCP.** Five chained branches, all merged to dev
  (`tasks/nodum-onboarding-docs-mcp-goal.md`):
  - *Branching* — `<kind>/<N>.<slug>_<contributor>_<DDMMYYYYHHMM>`, cut as a chain.
  - *Demo Workspace* — the "Second Brain" vault is a repo fixture (207 notes +
    manifest of folder colours by path, 13 graph groups); `POST /vaults/demo`
    imports it through `import_zip` and maps colours onto the created folders.
    Offered once (the tour's last step; a dialog on phones), creatable any time
    from Settings → Vault.
  - *Onboarding* — a spotlight tour over the real interface, keyboard driven,
    Skip/×/Esc route through the one demo question, re-runnable from a new Help
    "?" in the ribbon. Fixed a real layout leak between vaults in one tab and a
    lost-update race on `PATCH /auth/me`.
  - *Docs* — `/docs`: 21 articles, each with a "where" line and screenshots
    captured from the running app by `npm run docs:shots`. Reached from Help,
    the palette, the tour, Settings, the site nav.
  - *MCP* — Nodum is an MCP server at `/api/v1/mcp` (Streamable HTTP, stateless
    JSON), 36 tools over the same services and ownership checks as the app,
    per-user hashed revocable tokens (Settings → MCP with copy-paste configs for
    Claude Code / Claude Desktop / Cursor). Verified with raw JSON-RPC, the
    official client SDK and `claude mcp add` (✔ Connected).
  - *Review pass* — a 39-agent adversarial review confirmed 34 findings, all
    fixed on `bug/7.review-fixes_…`: an MCP cross-tenant read by note title
    (ownership check now precedes every lookup; exact title match), silent
    misfiling on invalid folder names (`ensure_folder_path` → ServiceResponse),
    the 4 MiB MCP body cap, tour focus/keyboard/inert/resize defects, lost
    first-run answers after token expiry, the deleted-vault dead end, and a
    dozen doc claims the app did not honour. Details in the goal doc.
  - *Second review pass* — 22 more on `bug/8.review-fixes-2_…`, including two
    regressions from the first fix (stale-list redirect, unverified-token
    rate-limit bucket), MCP tokens surviving password reset/change (revoked
    now), `list_attachments` crash, prepend-above-frontmatter, ⌘E double
    binding, and eight more doc claims. Details in the goal doc.
  - *Third review pass* — 13 more on `bug/10.review-fixes-3_…`, headline: a
    pre-existing cross-account leak in one browser (query cache + persisted
    vault survived logout) — fixed and e2e-covered; Claude Desktop config via
    env; token cap lock; demo-creation race; daily notes on the user's clock.
  - *Fourth pass (regressions only)* — backend dry; two web follow-ups from the
    sign-out change (boot-time cache clear vs. public pages; keep the open
    vault across sign-out) on `bug/11.review-fixes-4_…`. Loop closed.

- **2026-08-19: the backlog-and-release cycle → v3.3.0** (`tasks/nodum-release-cycle-goal.md`).
  Ten chained branches off `dev`, each gated and merged `--no-ff`:
  - *Collab under `--workers 4`* — shared seed (atomic Lua), heartbeat
    liveness, late-join catch-up that never resets over a live holder, single
    persist owner, per-save reset lock, presence relay across workers, local
    undo. Verified 6× against a real 4-worker API.
  - *Undo/redo* survives tab and mode switches (Compartments + per-pane/note
    history snapshots); Windows redo chord.
  - *Explorer click opens in the current tab*; `[[Note#Heading]]` lands on
    the heading (both views).
  - *AI*: streamed replies with live tool status; per-vault keys.
  - *Docs* full-text search with snippets.
  - *Tables*: per-cell undo, grid paste, arrow navigation, move row, focus
    follow-through, collab cell tints; unescape/escape made inverse.
  - *MCP*: SSE responses with progress on long tools; `packages/nodum-mcp`
    stdio bridge (not on npm yet).
  - The two long-standing e2e flakes had one cause (the switcher acting on
    stale results) — fixed in the product.
  - A 19-agent review of the cycle found 14 real defects (incl. a collab
    duplication on a slow holder and backslash doubling in tables) — fixed.
  - Prod image: bounded graceful shutdown (8 s) — open SSE streams kept
    workers alive on SIGTERM.
  - Gates at the release point: `make verify`, 155 backend integration,
    211 Playwright, all green.
