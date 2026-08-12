# Nodum

**Open-source, web-based knowledge management — linked markdown notes with an
interactive knowledge graph.** Inspired by [Obsidian](https://obsidian.md), built
for the web: sign up, create vaults, write notes with `[[wikilinks]]`, and explore
your ideas as a living graph.

> 🌐 nodum.md · Latin *nodum* — "knot, node"

## Features (v1 targets)

- 📝 **Markdown editor** — CodeMirror 6 with live preview, callouts, math (KaTeX),
  mermaid diagrams, task lists, and `[[wikilink]]` / `#tag` autocomplete
- 🔗 **Backlinks & unlinked mentions** — see every note that references the current one
- 🕸️ **Knowledge graph** — WebGL force-directed graph (global + local), filters,
  color groups, force sliders; smooth at 10k+ notes
- 🔍 **Full-text search** — operators (`path:`, `tag:`, `file:`), quick switcher, command palette
- 🏷️ **Tags & properties** — nested tags, YAML frontmatter properties
- 📅 **Daily notes & templates**
- 📦 **Obsidian-compatible import/export** — your notes are plain markdown, no lock-in
- 👥 **Multi-tenant** — accounts, multiple vaults per user

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 · Redis 7 · Celery · MinIO |
| Frontend | Next.js 15 · TypeScript · Tailwind CSS · CodeMirror 6 · sigma.js |
| Deploy | Docker Compose (dev/test/prod) — works with Docker or Podman |

## Quick start (development)

```bash
cd deploy
cp .env.example .env        # then edit values (see comments inside)
./compose.sh dev up -d      # postgres + redis + minio + api + web
```

- Web: http://localhost:3000
- API docs: http://localhost:8000/docs

## Repository layout

```
back/     FastAPI backend (uv, alembic, tests)
web/      Next.js frontend (+ Playwright e2e)
deploy/   docker-compose files, compose.sh, .env.example
tasks/    project plan & progress tracker
docs/     documentation
```

## Contributing

Branch model: `main` (production) ← `dev` (integration) ← `feature/*`.
Conventional commits (`feat:`, `fix:`, `chore:` …). Never commit `.env` or any
credential — CI rejects them; use `deploy/.env.example` as the template.

## License

[MIT](LICENSE)
