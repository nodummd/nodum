---
name: nodum-backend
description: Working on the nodum FastAPI backend (back/) — layering rules, ServiceResponse pattern, cache invalidation duties, link/tag sync hooks, migrations, and the concurrency conventions (row locks, ON CONFLICT, LIKE escaping). Use when adding or changing backend endpoints, services, or models.
---

# Nodum Backend

FastAPI + SQLAlchemy 2 async + Alembic + Redis + Celery. Layout mirrors the
hourly reference: `app/{api/v1,services,models,schemas,core,dependencies,utils,constants,tasks}`.

## Non-negotiable patterns

- **Routers thin, services fat.** Services return `ServiceResponse` and never
  raise HTTP errors; routers call `(await svc(...)).unwrap()` which maps
  error codes → app exceptions → the `{"error":{"code","message"}}` envelope.
  Success responses are `{"data": ...}`.
- **Every query is ownership-scoped.** First line of any vault-touching
  service: `get_owned_vault(db, vault_id, user_id)` — 404 on miss. Never
  query notes/folders/links without the vault_id predicate.
- **Cache invalidation is a write-path duty.** Anything that changes tree
  structure calls `invalidate_tree_cache`; anything that changes notes,
  links, tags, or paths calls `cache_delete(vault_graph_key(vault_id))`.
  Folder rename/move/delete changes note paths → BOTH.
- **Note-save hooks.** `note_service.create/update_content` must call
  `sync_note_links` + `sync_note_tags`; create/rename also call
  `resolve_links_for_new_note` (+ `unresolve_links_for_renamed_note` on
  rename). Batch imports resolve links in a second pass after all inserts.

## Concurrency lessons (paid for in audits — do not regress)

- Optimistic-concurrency checks need `with_for_update()` on the row
  (check-then-write races otherwise). See `note_service.update_content`.
- Path prefix queries MUST escape LIKE wildcards:
  `col.startswith(prefix + "/", autoescape=True)` — folder names may contain
  `%`/`_` and unescaped patterns corrupt sibling subtrees.
- Insert-or-ignore for uniquely-named rows: postgres
  `insert(...).on_conflict_do_nothing(constraint=...)` then re-select
  (see `tag_service.sync_note_tags`).
- Refresh-token rotation: `FOR UPDATE` on the session row + 30s Redis grace
  key for the spent JTI (`auth_service.refresh`). Never remove the grace.

## Migrations

`uv run alembic revision --autogenerate --rev-id 000N -m "desc"` from `back/`
(infra must be up), then `uv run alembic upgrade head`. Hand-add anything
autogenerate can't see (extensions like pg_trgm). New models must be exported
from `app/models/__init__.py` or autogenerate won't see them.

## Commands

```bash
cd back
uv run pytest tests -q          # 42 tests; integration needs dev infra up
uv run ruff check --fix . && uv run ruff format .
../deploy/compose.sh dev up -d postgres redis minio   # local infra (ports 15432/16379/19000)
```

Local `.env` in back/ points at the remapped dev ports; never commit it.
