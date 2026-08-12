#!/usr/bin/env bash
# ============================================================
# Nodum API — Pre-start script
# 1. Waits for PostgreSQL to accept connections
# 2. Runs Alembic migrations
# 3. Execs the CMD (uvicorn / celery)
# ============================================================
set -euo pipefail

echo "[pre-start] Waiting for PostgreSQL..."
uv run python - <<'EOF'
import asyncio
import os
import sys


def _build_db_url() -> str:
    server = os.environ.get("POSTGRES_SERVER", "")
    if server:
        user = os.environ.get("POSTGRES_USER", "nodum")
        password = os.environ.get("POSTGRES_PASSWORD", "nodum")
        port = os.environ.get("POSTGRES_PORT", "5432")
        db = os.environ.get("POSTGRES_DB", "nodum")
        return f"postgresql://{user}:{password}@{server}:{port}/{db}"
    url = os.environ.get("DATABASE_URL", "")
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


async def wait_for_db() -> None:
    import asyncpg

    url = _build_db_url()
    if not url:
        print("[pre-start] WARNING: No database URL configured. Skipping DB wait.")
        return

    for attempt in range(30):
        try:
            conn = await asyncpg.connect(url)
            await conn.close()
            print(f"[pre-start] Database ready after {attempt + 1} attempt(s).")
            return
        except Exception as exc:
            print(f"[pre-start] Attempt {attempt + 1}/30 failed: {exc}")
            await asyncio.sleep(2)

    print("[pre-start] ERROR: Database not ready after 60s. Aborting.")
    sys.exit(1)

asyncio.run(wait_for_db())
EOF

echo "[pre-start] Running Alembic migrations..."
uv run alembic upgrade head

echo "[pre-start] Migrations complete. Starting application..."
exec "$@"
