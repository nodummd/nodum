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

### 🧩 Extending

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
- **Built to scale** — async I/O end to end, Redis caching with targeted invalidation,
  Celery for import/export and background scans, WebGL rendering, CDN-friendly frontend.
- **Operationally honest** — structured logging, request-id middleware, security headers,
  CORS, deep `/health`, and an API that *refuses to boot* on placeholder secrets.

### Coming next

On `dev`, shipping in the next release: an **AI assistant** you bring your own key for —
Claude, OpenAI, Gemini or Qwen, encrypted at rest with Fernet — that can search, read,
create and append to notes in your vault, with per-vault chat history; **multi-vault
browser tabs**; and **directly editable tables**.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 + pgvector · Redis 7 · Celery (+beat) · MinIO |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · CodeMirror 6 · @cosmos.gl/graph · shadcn/radix · TanStack Query · Zustand |
| Realtime | Yjs · pycrdt over websockets |
| Deploy | Docker Compose (dev / test / prod) — Docker or Podman |

## Quick start

```bash
git clone git@github.com:vorreix/nodum.git
cd nodum/deploy
cp .env.example .env        # then edit the values (every one is commented)
./compose.sh dev up -d      # postgres + redis + minio + api + web
```

- Web → <http://localhost:3000> · API docs → <http://localhost:8000/docs>

Or from the repo root: `make dev-up`, `make dev-logs`, `make dev-down`
(`make help` lists everything).

## Self-hosting

```bash
cd deploy
./compose.sh prod up -d --build
```

Fill `deploy/.env` with real secrets first — **the API refuses to start with placeholder
values**. Put a reverse proxy in front of `web:3000`; if it terminates TLS, set
`TRUST_PROXY_HEADERS=true` so rate limiting sees real client IPs. Every compose host port
binds to `127.0.0.1`, and prod containers run non-root.

Deployment and backup/restore runbooks live in [`docs/deploy.md`](docs/deploy.md) and
[`docs/backup.md`](docs/backup.md).

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
deploy/    docker-compose dev/test/prod, compose.sh, .env.example
docs/      deploy & backup runbooks, collab notes, Obsidian-parity research specs
tasks/     master plan, audit & roadmap, backlog — the decision documents
```

## Roadmap

Tracked in [`tasks/nodum-audit-and-roadmap.md`](tasks/nodum-audit-and-roadmap.md) and
[`tasks/nodum-master-plan.md`](tasks/nodum-master-plan.md) (the single source of truth for
project state). Near-term: the AI assistant release, a properties/frontmatter editing UI,
live-preview math, and trash/restore.

## Contributing

- **Branch model** — `main` (production) ← `dev` (integration) ← `feature/*`, merged back
  with `--no-ff`. [Conventional commits](https://www.conventionalcommits.org/).
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
