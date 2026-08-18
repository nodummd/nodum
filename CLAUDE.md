# Nodum — Claude Code Instructions

Nodum is an open-source, web-based Obsidian alternative: multi-tenant markdown
knowledge base with wikilinks, backlinks, and an interactive knowledge graph.

**Always read `tasks/nodum-master-plan.md` first** — it is the single source of
truth for project state, architecture, and what to build next. Update it
(checkboxes + Progress Log) at the end of every work session.

## Layout

- `back/` — FastAPI backend (uv, SQLAlchemy 2 async, alembic, Redis, Celery)
- `web/` — Next.js frontend (App Router, TypeScript, Tailwind v4, CodeMirror 6, sigma.js)
- `deploy/` — compose stacks (dev/test/staging/prod) + `compose.sh` + `caddy/` +
  `smoke.sh` + per-environment `.env*.example`. staging and prod share
  `docker-compose.deploy.yml`, so staging mirrors prod by construction.
- `tasks/` — master plan; `docs/research/` — research specs (Obsidian parity)

## Rules

- **Git flow**: `main` = prod, `dev` = integration. Work happens on branches
  named `<kind>/<N>.<slug>_<contributor>_<DDMMYYYYHHMM>` — `<kind>` is
  `feature` | `hotfix` | `chore` | `bug`, `<N>` numbers the branch in its
  chain, `<slug>` is a short lowercase what-it-is, `<contributor>` the person's
  handle, and the timestamp is 24-hour (`190820260134` = 19 Aug 2026 01:34).
  Branches form a **chain**: the first is cut from `dev`, each next one from
  the tip of the previous, e.g. `dev → feature/1.demo-workspace_maqbool_…
  → feature/2.onboarding_maqbool_… → hotfix/3.graph-fit_maqbool_…`. Every
  branch merges into `dev` with `--no-ff` when done. Conventional commits,
  authored as the contributor's own git identity.
- **Never commit secrets** — `.env` is gitignored; only `.env.example` with
  placeholders. This repo is public.
- Backend: routers thin / services fat (`ServiceResponse.unwrap()` pattern);
  responses `{"data": ...}`, errors `{"error": {"code","message"}}`;
  numbered alembic migrations (`0001_...`); **`make verify` must pass before
  commit** — it runs the exact gate CI runs. `ruff check` alone is not enough:
  CI also runs `ruff format --check`, and skipping it is what silently rotted
  the pipeline before.
- All compose host ports bind to `127.0.0.1`. Containers run non-root in prod.
- Frontend: workspace state in Zustand, server data via TanStack Query;
  API access only through `src/lib/api/`.

## Commands

- `make verify` — the full pre-push gate (everything CI runs except e2e)
- `make dev-up` / `make dev-down` — full dev stack via Docker
- `make back-test back-test-int back-lint` — backend checks
- `make web-typecheck web-lint web-build` — web checks
- `make e2e` — Playwright suite
