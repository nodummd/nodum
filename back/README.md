# Nodum Backend

FastAPI backend for Nodum. See the repository root [README](../README.md) and
[tasks/nodum-master-plan.md](../tasks/nodum-master-plan.md) for architecture.

## Development

```bash
uv sync                 # install deps
uv run uvicorn app.main:app --reload   # run locally (needs postgres+redis, see deploy/)
uv run pytest tests/unit               # unit tests (no infra needed)
uv run ruff check . && uv run ruff format --check .   # lint
```

Migrations:

```bash
uv run alembic revision --autogenerate -m "description"   # new migration
uv run alembic upgrade head
```
