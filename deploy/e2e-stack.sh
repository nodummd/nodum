#!/usr/bin/env bash
# ============================================================
# The stack the Playwright suite expects, brought up the way CI
# brings it up.
#
# `make e2e` said "needs test stack up" and nothing started one: `make
# test-up` runs no web server, and its ports are not the ones Playwright
# defaults to. So everyone reverse-engineered this from ci-e2e.yml, which is
# easy to get subtly wrong — a web server left running while `make verify`
# rebuilds `.next` underneath it serves a half-replaced build, and every spec
# then fails at signup for a reason that looks nothing like the cause.
#
# Ports, env and startup order mirror .github/workflows/ci-e2e.yml. When that
# changes, change this with it.
#
# Usage:  ./deploy/e2e-stack.sh up      (or: make e2e-up)
#         ./deploy/e2e-stack.sh down
#         ./deploy/e2e-stack.sh status
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${TMPDIR:-/tmp}/nodum-e2e"

PG_PORT=15432
REDIS_PORT=16379
MINIO_PORT=19000
API_PORT=8000
WEB_PORT=3100

# Matches CI: pgvector, because a migration creates the extension and plain
# postgres fails at `CREATE EXTENSION vector` with nothing else wrong.
PG_IMAGE="pgvector/pgvector:0.8.0-pg16"

export POSTGRES_SERVER=localhost POSTGRES_PORT=$PG_PORT
export POSTGRES_USER=nodum POSTGRES_PASSWORD=nodum POSTGRES_DB=nodum
export REDIS_URL="redis://localhost:$REDIS_PORT/0"
export S3_ENDPOINT_URL="http://localhost:$MINIO_PORT" S3_PUBLIC_URL="http://localhost:$MINIO_PORT"
export S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin
export ENVIRONMENT=dev
# ai-chat.spec.ts points a provider at a stub on 127.0.0.1, which the SSRF
# guard refuses by default and correctly so. The e2e stack is single-tenant
# and the stub is the point; the integration suite still runs with it off.
export AI_ALLOW_PRIVATE_BASE_URLS=true

say() { printf '\033[36m›\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

wait_for() {
  local what=$1 probe=$2 tries=${3:-60}
  for _ in $(seq 1 "$tries"); do
    if eval "$probe" >/dev/null 2>&1; then say "$what ready"; return 0; fi
    sleep 1
  done
  die "$what never became ready"
}

# Detached in every sense that matters: no controlling terminal, and none of
# the caller's descriptors. Without closing stdin and stdout the server keeps
# the pipe `make` is reading open, so `make e2e-up` never returns even though
# the stack came up fine — which reads as a hang rather than as success.
start_detached() {
  local dir=$1 log=$2; shift 2
  ( cd "$dir" && exec nohup "$@" >"$log" 2>&1 <"/dev/null" ) &
  disown 2>/dev/null || true
}

container() {
  local name=$1; shift
  if [ -n "$(docker ps -q -f "name=^${name}$")" ]; then
    say "$name already running"
  else
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" "$@" >/dev/null
    say "$name started"
  fi
}

up() {
  command -v docker >/dev/null || die "docker is not on PATH"
  mkdir -p "$RUN_DIR"

  container nodum-test-pg \
    -e POSTGRES_USER=nodum -e POSTGRES_PASSWORD=nodum -e POSTGRES_DB=nodum \
    -p "127.0.0.1:$PG_PORT:5432" "$PG_IMAGE"
  container nodum-test-redis -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine
  container nodum-test-minio \
    -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
    -p "127.0.0.1:$MINIO_PORT:9000" minio/minio server /data

  wait_for postgres "docker exec nodum-test-pg pg_isready -U nodum"
  wait_for minio "curl -sf http://127.0.0.1:$MINIO_PORT/minio/health/live"

  # A generated key, so nothing secret-shaped is ever committed, and stable for
  # the life of the stack so a restart does not orphan what it encrypted.
  if [ ! -f "$RUN_DIR/ai.key" ]; then
    (cd "$ROOT/back" && uv run python -c \
      'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())') > "$RUN_DIR/ai.key"
  fi
  export AI_ENCRYPTION_KEY="$(cat "$RUN_DIR/ai.key")"

  say "migrating"
  (cd "$ROOT/back" && uv run alembic upgrade head >"$RUN_DIR/migrate.log" 2>&1) \
    || { cat "$RUN_DIR/migrate.log"; die "migration failed"; }
  # The API skips lifespan under some runners, so make the bucket here.
  (cd "$ROOT/back" && uv run python -c \
    'from app.core.s3 import ensure_buckets_exist; ensure_buckets_exist()' >/dev/null 2>&1) || true

  stop_port "$API_PORT" "uvicorn app.main:app"
  start_detached "$ROOT/back" "$RUN_DIR/api.log" \
    uv run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT"
  wait_for api "curl -sf http://127.0.0.1:$API_PORT/health"

  # Built, not dev-served, and always rebuilt: API_PROXY_URL is baked into the
  # route manifest at BUILD time, and a stale `.next` is the failure that looks
  # like a broken app rather than a stale build.
  say "building web (API_PROXY_URL=http://127.0.0.1:$API_PORT)"
  stop_port "$WEB_PORT" "next start -p $WEB_PORT"
  (cd "$ROOT/web" && API_PROXY_URL="http://127.0.0.1:$API_PORT" NEXT_TELEMETRY_DISABLED=1 \
    npm run build >"$RUN_DIR/build.log" 2>&1) || { tail -30 "$RUN_DIR/build.log"; die "web build failed"; }
  start_detached "$ROOT/web" "$RUN_DIR/web.log" npx next start -p "$WEB_PORT"
  wait_for web "curl -sf http://127.0.0.1:$WEB_PORT"

  printf '\n\033[32m✓\033[0m stack up. Run the suite with:\n\n    cd web && BASE_URL=http://127.0.0.1:%s npx playwright test\n\n' "$WEB_PORT"
  printf 'Logs: %s\n' "$RUN_DIR"
  printf '\033[33m!\033[0m `make verify` rebuilds .next — run `make e2e-up` again afterwards.\n'
}

stop_port() {
  local port=$1 pattern=$2
  pkill -f "$pattern" >/dev/null 2>&1 || true
  sleep 1
}

down() {
  stop_port "$WEB_PORT" "next start -p $WEB_PORT"
  stop_port "$API_PORT" "uvicorn app.main:app"
  docker rm -f nodum-test-pg nodum-test-redis nodum-test-minio >/dev/null 2>&1 || true
  say "stack down"
}

status() {
  docker ps --filter "name=nodum-test-" --format '  {{.Names}}\t{{.Status}}'
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 \
    && say "api  http://127.0.0.1:$API_PORT" || say "api  down"
  curl -sf "http://127.0.0.1:$WEB_PORT" >/dev/null 2>&1 \
    && say "web  http://127.0.0.1:$WEB_PORT" || say "web  down"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) die "usage: $0 {up|down|status}" ;;
esac
