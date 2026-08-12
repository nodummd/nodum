# Nodum

**Open-source, web-based knowledge management — linked markdown notes with an
interactive knowledge graph.** Inspired by [Obsidian](https://obsidian.md), built
for the web: sign up, create vaults, write notes with `[[wikilinks]]`, and explore
your ideas as a living graph.

> 🌐 nodum.md · Latin *nodum* — "knot, node"

## What works today (v1.0)

- 📝 **Live Preview editor** (CodeMirror 6, the same engine Obsidian uses) —
  syntax hides as you write and reveals at the cursor: sized headings,
  bold/italic/strike, `==highlights==`, inline code, clickable task
  checkboxes, accent bullets, code fences
- 🔗 **Wikilinks everywhere** — `[[Note]]`, `[[path/Note]]`, `[[Note|alias]]`,
  autocomplete on `[[`, click-to-follow, and clicking an *unresolved* link
  creates the note instantly (backlinks resolve on the spot)
- 🧭 **Backlinks panel** — linked mentions with context snippets + unlinked
  mentions, outgoing links, tag pane, outline
- 🕸️ **GPU knowledge graph** (`@cosmos.gl/graph`, WebGL2) — force-simulated,
  draggable, node size by degree, ghost nodes for unresolved links
  (click to create), filters, force sliders, floating labels
- 💬 **Callouts** — all 13 Obsidian types + aliases with icons, colors, and
  folding, in both Live Preview and Reading view
- 🔍 **Full-text search** (Postgres FTS) with `path:` `file:` `tag:`
  operators, phrases and `-exclusions`; fuzzy **quick switcher** (⌘O) that
  creates on no-match; **command palette** (⌘P)
- 📖 **Reading view** with KaTeX math, GFM tables, and in-app wikilink
  navigation; **source mode** for raw markdown (⌘E cycles)
- 🏷️ **Tags** — inline `#tags` + frontmatter, nested (`#a/b`) with prefix
  matching, counts, graph coloring data
- 📅 **Daily notes & templates** — configurable date format/folder/template
  with `{{title}}` `{{date}}` `{{time}}` `{{date:FORMAT}}` variables
- 📦 **Obsidian-compatible import/export** — drop in a vault zip, get a
  folder-true zip back; links resolve across the whole import batch
- 🖼️ **Attachments** on S3/MinIO with `![[filename]]` resolution
- 👥 **Multi-tenant auth** — JWT with rotation + reuse defense (and a grace
  window for racing tabs), httpOnly first-party refresh cookie, argon2id

**Verified by 42 backend integration tests + 18 Playwright e2e tests, and a
full production-compose boot check (signup→graph→export through the prod
proxy chain) — all wired into CI.**

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 · Redis 7 · Celery (+beat) · MinIO |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · CodeMirror 6 · @cosmos.gl/graph · shadcn/radix |
| Deploy | Docker Compose (dev/test/prod) — Docker or Podman |

## Quick start (development)

```bash
cd deploy
cp .env.example .env        # then edit values (see comments inside)
./compose.sh dev up -d      # postgres + redis + minio + api + web
```

- Web: http://localhost:3000 · API docs: http://localhost:8000/docs

Production: fill real secrets in `deploy/.env` (the API **refuses to boot**
with placeholders) and `./compose.sh prod up -d --build`, then put a reverse
proxy in front of web:3000. Rate limiting behind a proxy needs
`TRUST_PROXY_HEADERS=true`.

## Testing

```bash
cd back && uv run pytest tests -q     # 42 integration tests (infra up first)
cd web && npx playwright test          # 18 e2e (api + web running)
```

## Repository layout

```
back/     FastAPI backend (uv, alembic, tests)
web/      Next.js frontend (+ Playwright e2e)
deploy/   docker-compose files, compose.sh, .env.example
tasks/    master plan · audit & roadmap (the decision docs)
docs/     research specs (Obsidian parity, library decisions)
```

## Contributing

Branch model: `main` (production) ← `dev` (integration) ← `feature/*`,
conventional commits. Both test suites and lint must pass. Never commit
`.env` or any credential — CI runs gitleaks on every push.

Roadmap: see [tasks/nodum-audit-and-roadmap.md](tasks/nodum-audit-and-roadmap.md)
(next up: inline embeds, properties UI, live-preview math, publish, and
real-time collaboration).

## License

[MIT](LICENSE)
