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
