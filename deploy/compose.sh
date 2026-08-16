#!/usr/bin/env bash
# ============================================================
# Nodum Docker Compose Helper
# ============================================================
# Usage:
#   ./compose.sh dev up -d              # Development
#   ./compose.sh test up -d             # Isolated test stack
#   ./compose.sh staging up -d --build  # Staging (mirrors production)
#   ./compose.sh prod up -d --build     # Production
#   ./compose.sh dev logs -f api        # Follow API logs
#
# Environment files, in order of preference:
#   dev      -> .env.dev      | .env
#   test     -> .env.test     | .env
#   staging  -> .env.staging  (required — copy .env.staging.example)
#   prod     -> .env.prod     (required — copy .env.prod.example)
#
# staging and prod insist on their own file rather than falling back to .env.
# Sharing one file is how a staging deploy ends up pointed at the production
# database, and how the dev stack's known-default credentials end up on a
# public host.
#
# Verifying the production stack locally, beside a running dev stack:
#   NODUM_HTTP_PORT=8080 NODUM_HTTPS_PORT=8443 ./compose.sh prod up -d --build
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

# ── Resolve the environment file ────────────────────────────
env_file=""
resolve_env_file() {
    local preferred="$SCRIPT_DIR/.env.$1"
    if [ -f "$preferred" ]; then
        env_file="$preferred"
        return
    fi
    case "$1" in
        staging|prod)
            echo "ERROR: $preferred not found." >&2
            echo "       cp $SCRIPT_DIR/.env.$1.example $preferred  # then fill it in" >&2
            echo "       ($1 will not fall back to .env — see the header of this script)" >&2
            exit 1
            ;;
    esac
    if [ -f "$SCRIPT_DIR/.env" ]; then
        env_file="$SCRIPT_DIR/.env"
        return
    fi
    echo "ERROR: no $preferred and no $SCRIPT_DIR/.env." >&2
    echo "       cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env" >&2
    exit 1
}

# ── Compose invocation ──────────────────────────────────────
# ENVIRONMENT and the image tag are exported here rather than read from the
# env file: which stack you asked for is decided by the argument you typed,
# never by whichever file happens to be on disk.
run() {
    local project="$1"; shift
    local -a files=()
    for f in "$@"; do files+=(-f "$SCRIPT_DIR/$f"); done
    "${ENGINE[@]}" --env-file "$env_file" "${files[@]}" --project-name "$project" "${ARGS[@]}"
}

# A non-empty S3_ENDPOINT_URL means attachments live in a managed store, so the
# bundled MinIO is dead weight. Read from the file rather than the environment:
# the file is the single source of truth for what this deployment is, and a
# stray exported variable in someone's shell must not silently change which
# services get started.
uses_external_s3() {
    grep -qE '^[[:space:]]*S3_ENDPOINT_URL[[:space:]]*=[[:space:]]*[^[:space:]#]' "$env_file"
}

# Assemble the file list for a deployment environment, adding the external-S3
# override only when it applies. Fills the FILES array rather than echoing, so
# nothing depends on word splitting.
FILES=()
collect_deploy_files() {
    FILES=(docker-compose.yml docker-compose.deploy.yml "$1")
    if uses_external_s3; then FILES+=(docker-compose.external-s3.yml); fi
}

ARGS=("$@")

case "$ENV" in
    dev)
        resolve_env_file dev
        export NODUM_ENVIRONMENT=dev NODUM_IMAGE_TAG="${NODUM_IMAGE_TAG:-dev}"
        run nodum-dev docker-compose.yml docker-compose.dev.yml
        ;;
    test)
        resolve_env_file test
        export NODUM_ENVIRONMENT=test NODUM_IMAGE_TAG="${NODUM_IMAGE_TAG:-test}"
        run nodum-test docker-compose.yml docker-compose.test.yml
        ;;
    staging)
        resolve_env_file staging
        export NODUM_ENVIRONMENT=staging NODUM_IMAGE_TAG="${NODUM_IMAGE_TAG:-staging}"
        collect_deploy_files docker-compose.staging.yml
        run nodum-staging "${FILES[@]}"
        ;;
    prod)
        resolve_env_file prod
        export NODUM_ENVIRONMENT=production NODUM_IMAGE_TAG="${NODUM_IMAGE_TAG:-prod}"
        collect_deploy_files docker-compose.prod.yml
        run nodum-prod "${FILES[@]}"
        ;;
    *)
        echo "Usage: $0 {dev|test|staging|prod} [compose args...]" >&2
        exit 1
        ;;
esac
