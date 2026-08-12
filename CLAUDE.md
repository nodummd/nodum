# Nodum — Claude Code Instructions

Nodum is an open-source, web-based Obsidian alternative: multi-tenant markdown
knowledge base with wikilinks, backlinks, and an interactive knowledge graph.

**Always read `tasks/nodum-master-plan.md` first** — it is the single source of
truth for project state, architecture, and what to build next. Update it
(checkboxes + Progress Log) at the end of every work session.

## Layout

- `back/` — FastAPI backend (uv, SQLAlchemy 2 async, alembic, Redis, Celery)
- `web/` — Next.js frontend (App Router, TypeScript, Tailwind v4, CodeMirror 6, sigma.js)
- `deploy/` — docker-compose (dev/test/prod) + `compose.sh` + `.env.example`
- `tasks/` — master plan; `docs/research/` — research specs (Obsidian parity)

## Rules

- **Git flow**: `main` = prod, `dev` = integration; every feature on `feature/<name>`
  branched from `dev`, merged back with `--no-ff`. Conventional commits.
- **Never commit secrets** — `.env` is gitignored; only `.env.example` with
  placeholders. This repo is public.
- Backend: routers thin / services fat (`ServiceResponse.unwrap()` pattern);
  responses `{"data": ...}`, errors `{"error": {"code","message"}}`;
  numbered alembic migrations (`0001_...`); `uv run pytest tests/unit` and
  `uv run ruff check .` must pass before commit.
- All compose host ports bind to `127.0.0.1`. Containers run non-root in prod.
- Frontend: workspace state in Zustand, server data via TanStack Query;
  API access only through `src/lib/api/`.

## Commands

- `make dev-up` / `make dev-down` — full dev stack via Docker
- `make back-test back-lint` — backend checks
- `make web-build web-lint` — web checks
- `make e2e` — Playwright suite
