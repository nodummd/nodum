<p align="center">
  <img src="assets/nodum-logo.png" alt="Nodum" width="132" />
</p>

<h1 align="center">Nodum</h1>

<p align="center">
  <b>An open-source, web-based knowledge base.</b><br>
  Linked markdown notes, backlinks, and a GPU-rendered knowledge graph — everything<br>
  Obsidian does in core, in the browser: multi-tenant, self-hostable, no lock-in.
</p>

<p align="center">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Version 3.2.0" src="https://img.shields.io/badge/version-3.2.0-brightgreen.svg">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-async-009688.svg">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black.svg">
  <img alt="Docker Compose" src="https://img.shields.io/badge/deploy-docker%20compose-2496ED.svg">
</p>

> ***nodum*** — Latin for *"knot, node."* Notes are the knots; the value is in the rope between them.

---

## Why

[Obsidian](https://obsidian.md) is a superb local-first markdown knowledge base built on
plain files, `[[wikilinks]]`, backlinks and a graph view. It is also closed-source and
desktop-first.

**Nodum is the open-source web equivalent.** Sign up, create vaults, write linked markdown,
and explore your thinking as a living graph — from any browser, on any machine. Your notes
stay plain markdown the whole time: drop in an Obsidian vault as a zip, get a folder-true
zip back whenever you want to leave.

**Status** — `main` is the released line (**v3.2.0**); `dev` is integration. See
[Coming next](#coming-next) for what is landing in the next release.

## Features

### ✍️ Writing

- **Live Preview editor** — CodeMirror 6, the same engine Obsidian uses. Syntax hides as
  you write and reveals at the cursor: sized headings, bold/italic/strike,
  `==highlights==`, inline code, clickable task checkboxes, accent bullets, code fences.
- **Three modes** — Live Preview, raw **Source**, and **Reading** view (⌘E cycles).
- **Callouts** — all 13 Obsidian types plus aliases, with icons, colours and folding, in
  both Live Preview and Reading view.
- **Rich markdown** — KaTeX math (inline and block), Mermaid diagrams, GFM tables,
  footnotes, blockquotes, syntax-highlighted code blocks.
- **Attachments** — paste or drag-and-drop straight into the editor; files land in
  S3/MinIO and embed as `![[image.png]]`, with hover preview cards (images inline, PDFs
  scrollable). 5 MB cap, magic-byte MIME verification, no `.svg`/`.html`.
- **Autosave** — debounced, with optimistic-concurrency conflict detection.

### 🔗 Linking & the graph

- **Wikilinks everywhere** — `[[Note]]`, `[[path/Note]]`, `[[Note|alias]]`, autocomplete
  on `[[`, click-to-follow. Clicking an *unresolved* link creates that note instantly and
  the backlink resolves on the spot.
- **Backlinks pane** — linked mentions with context snippets, unlinked mentions
  (plain-text occurrences of the title), and outgoing links.
- **GPU knowledge graph** — `@cosmos.gl/graph` on WebGL2: force-simulated and draggable,
  node size by degree, ghost nodes for unresolved links (click to create), search and tag
  filters, live force sliders, floating labels that fade with zoom. Global **and** local
  graph, with a guard so a lost WebGL context can never take the workspace down.
- **Semantically related notes** — pgvector cosine similarity over note embeddings,
  surfacing connections you never linked by hand.

### 🔍 Finding

- **Full-text search** — Postgres FTS (tsvector + GIN) with `path:` `file:` `tag:`
  operators, quoted phrases and `-exclusions`.
- **Quick switcher** (⌘O) — fuzzy title jump that creates the note when nothing matches.
- **Command palette** (⌘P) — every workspace command, searchable.
- **Tags** — inline `#tags` and frontmatter, nested (`#a/b`) with prefix matching, tag
  pane with counts, click through to search.
- **Bookmarks**, **outline** pane, and per-pane **back/forward** navigation history.

### 🗂️ Organising

- **Vaults and folders** — many vaults per user, nested folders, drag-and-drop moves, and
  an Obsidian-parity context menu (open in new tab / to the right / new window, duplicate,
  move, merge, bookmark, copy path, version history, rename, delete).
- **Folder colours** inherited down the tree.
- **Daily notes & templates** — configurable date format, folder and template, with
  `{{title}}` `{{date}}` `{{time}}` `{{date:FORMAT}}` variables.
- **Version history** — every save snapshots server-side; browse and restore.
- **Canvas** — freeform whiteboard boards alongside your notes.
- **Import / export** — Obsidian-compatible vault zips both ways (with root-unwrapping,
  `.obsidian` config detection, `.txt`/`.markdown` support and PDF text extraction), or
  import a folder directly. Links resolve across the whole import batch.

### 👥 Sharing & collaborating

- **Real-time collaboration** — Yjs CRDT over websockets (`pycrdt`), per note, with
  presence.
- **Publish** — public share links per note and a public site view per vault.

### 🧭 Getting your bearings
- **First-run tour** — a spotlight walk through the real interface, skippable, re-runnable from Help.
- **Demo Workspace** — 200 linked notes with coloured folders and graph groups, one click, so you can explore before you write.
- **Documentation at `/docs`** — every button and panel explained, with screenshots captured from the app itself.

### 🤝 Editing together
- **Live collaboration** that works across API workers — one shared document seed, presence everywhere, your own undo.
- **Tables you type into**: cells, rows and columns, paste a grid from a spreadsheet, move rows, per-cell undo.

### 🤖 AI, your key
- **An assistant you bring your own key for** — Claude, OpenAI, Gemini or Qwen, encrypted at rest — that searches, reads, creates and extends notes in your vault, streams its replies, keeps per-vault chat history, and can use a different key per vault.

### 🧩 Extending
- **MCP server** — Nodum speaks the Model Context Protocol: point Claude Code, Claude Desktop or Cursor at `/api/v1/mcp` with a token and the AI can create vaults, write and link notes, colour folders, search, import and export — 36 tools, same rules as the app, progress on long imports. A stdio bridge lives in `packages/nodum-mcp`.

- **Plugins** — a capability-scoped API inside an opaque-origin sandboxed iframe
  (`sandbox="allow-scripts"`, no `allow-same-origin`, `connect-src 'none'`), permission
  checks enforced host-side, registry UI in Settings.
- **Web Clipper** — an MV3 Chrome extension in [`clipper/`](clipper/), backed by scoped,
  hashed, revocable tokens that can *only* create notes — revoking one never touches your
  session.
- **Versioned REST API** at `/api/v1` with OpenAPI docs at `/docs`.

### 🔐 Platform

- **Multi-tenant auth** — argon2id hashing, JWT access + refresh rotation with reuse
  defence (and a grace window so racing tabs don't log you out), httpOnly first-party
  refresh cookie, rate-limited auth endpoints.
- **Email verification** — six-digit code on signup, stored as an HMAC and never in
  the clear, with attempt limits and a resend cooldown. Delivery walks an ordered
  provider chain (Brevo → Mailjet → Resend → Mailgun → any SMTP relay), which both
  survives one provider's bad hour and stacks their free tiers. Outside production
  nothing is mailed and the code is always `123456`.
- **Account recovery and closure** — forgotten-password reset by mailed code (which
  drops every existing session, since that is what a reset is *for*), password change
  from settings, and account deletion behind its own emailed code, taking the vaults,
  notes and stored files with it. Codes are scoped by purpose, so a reset code cannot
  delete an account.
- **Built to scale** — async I/O end to end, Redis caching with targeted invalidation,
  Celery for import/export and background scans, WebGL rendering, CDN-friendly frontend.
- **Operationally honest** — structured logging, request-id middleware, security headers,
  CORS, deep `/health`, and an API that *refuses to boot* on placeholder secrets.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 + pgvector · Redis 7 · Celery (+beat) · MinIO |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · CodeMirror 6 · @cosmos.gl/graph · shadcn/radix · TanStack Query · Zustand |
| Realtime | Yjs · pycrdt over websockets |
| Deploy | Docker Compose (dev / test / staging / prod) + Caddy edge proxy with automatic TLS — Docker or Podman |

## Quick start

```bash
git clone git@github.com:nodummd/nodum.git
cd nodum/deploy
cp .env.example .env        # then edit the values (every one is commented)
./compose.sh dev up -d      # postgres + redis + minio + api + web
```

- Web → <http://localhost:3000> · API docs → <http://localhost:8000/docs>

Or from the repo root: `make dev-up`, `make dev-logs`, `make dev-down`
(`make help` lists everything).

## Self-hosting

```bash
cp deploy/.env.prod.example deploy/.env.prod   # fill it in, then chmod 600
cd deploy && ./compose.sh prod up -d --build
./smoke.sh https://your-domain                 # signup → note → attachment round-trip
```

The stack is fully containerised, edge proxy included. **Caddy** terminates TLS
(certificates provisioned and renewed automatically), proxies `/api` to the API and `/s3`
to MinIO for presigned attachment URLs, and is the only container that binds a host port —
Postgres and Redis aren't even on its network. Schema changes run in a one-shot `migrate`
container that everything else waits on, so no two containers ever race Alembic.

**Staging is the same stack**, from the same compose layer, with its own credentials and
ports so it can share a host:

```bash
cp deploy/.env.staging.example deploy/.env.staging
cd deploy && ./compose.sh staging up -d --build
```

The API refuses to start on placeholder or known-default credentials, in staging as well
as production. Deployment and backup/restore runbooks live in
[`docs/deploy.md`](docs/deploy.md) and [`docs/backup.md`](docs/backup.md).

## Testing

```bash
cd back && uv run pytest tests -q      # backend (bring infra up first)
cd web  && npx playwright test         # e2e (api + web running)
```

v3.2.0 ships green with **87 backend tests** (70 integration + 17 unit) and **77 Playwright
end-to-end tests**, plus a full production-compose boot check that drives
signup → graph → export through the real prod proxy chain. All of it runs in CI on every
push, alongside gitleaks secret scanning.

## Repository layout

```
back/      FastAPI backend — app/{api,services,models,schemas}, alembic, tests
web/       Next.js frontend — app router, workspace UI, CM6 editor, graph, Playwright e2e
clipper/   MV3 Chrome extension (Web Clipper)
deploy/    compose stacks (dev/test/staging/prod), Caddy config, smoke test, .env examples
docs/      deploy & backup runbooks, collab notes, Obsidian-parity research specs
tasks/     master plan, audit & roadmap, backlog — the decision documents
```

## Roadmap

Tracked in [`tasks/nodum-audit-and-roadmap.md`](tasks/nodum-audit-and-roadmap.md) and
[`tasks/nodum-master-plan.md`](tasks/nodum-master-plan.md) (the single source of truth for
project state). Near-term: the AI assistant release, a properties/frontmatter editing UI,
live-preview math, and trash/restore.

## Contributing

- **Branch model** — `main` (production) ← `dev` (integration) ← work branches, merged
  back with `--no-ff`. Branches are named
  `<kind>/<N>.<slug>_<contributor>_<DDMMYYYYHHMM>` — `<kind>` is `feature`, `hotfix`,
  `chore` or `bug`; `<N>` numbers the branch in its chain; the timestamp is 24-hour —
  and are cut **as a chain**: the first from `dev`, each next from the previous one
  (`dev → feature/1.demo-workspace_maqbool_190820260150 →
  feature/2.onboarding_maqbool_190820260430`).
  [Conventional commits](https://www.conventionalcommits.org/).
- **Green before commit** — `uv run pytest tests/unit` and `uv run ruff check .` for the
  backend; `npm run build` and `npm run lint` for the web app.
- **Never commit secrets.** `.env` is gitignored; only `.env.example` with placeholders
  ever lands in the repo, and CI runs gitleaks on every push.

Backend keeps routers thin and services fat (the `ServiceResponse.unwrap()` pattern),
responses are `{"data": ...}` and errors `{"error": {"code", "message"}}`; migrations are
numbered (`0001_...`). Frontend keeps workspace state in Zustand, server data in TanStack
Query, and all API access behind `web/src/lib/api/`.

## Author

Built and maintained by **Maqbool Thoufeeq T**
— [@maqboolthoufeeq](https://github.com/maqboolthoufeeq) · <maqboolthoufeeq.t@gmail.com>

## License

[MIT](LICENSE) © 2026 Maqbool Thoufeeq T
