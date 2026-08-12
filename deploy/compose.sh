#!/usr/bin/env bash
# ============================================================
# Nodum Docker Compose Helper
# ============================================================
# Usage:
#   ./compose.sh dev up -d         # Start dev environment
#   ./compose.sh dev down          # Stop dev environment
#   ./compose.sh test up -d        # Start test environment
#   ./compose.sh prod up -d        # Start production
#   ./compose.sh dev logs -f api   # Follow API logs
#
# Works with Docker or Podman (podman compose).
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV="${1:-dev}"
shift || true

# Pick container engine: docker (preferred) or podman
if command -v docker >/dev/null 2>&1; then
    ENGINE=(docker compose)
elif command -v podman >/dev/null 2>&1; then
    ENGINE=(podman compose)
else
    echo "ERROR: neither docker nor podman found." >&2
    exit 1
fi

# Load environment variables
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

case "$ENV" in
    dev)
        "${ENGINE[@]}" \
            -f "$SCRIPT_DIR/docker-compose.yml" \
            -f "$SCRIPT_DIR/docker-compose.dev.yml" \
            --project-name nodum-dev \
            "$@"
        ;;
    test)
        "${ENGINE[@]}" \
            -f "$SCRIPT_DIR/docker-compose.yml" \
            -f "$SCRIPT_DIR/docker-compose.test.yml" \
            --project-name nodum-test \
            "$@"
        ;;
    prod)
        "${ENGINE[@]}" \
            -f "$SCRIPT_DIR/docker-compose.yml" \
            -f "$SCRIPT_DIR/docker-compose.prod.yml" \
            --project-name nodum-prod \
            "$@"
        ;;
    *)
        echo "Usage: $0 {dev|test|prod} [compose args...]"
        exit 1
        ;;
esac
