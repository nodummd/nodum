# ============================================================
# Nodum — Development Makefile
# ============================================================

.PHONY: help dev-up dev-down dev-logs test-up test-down back-test back-lint back-format web-dev web-build web-lint e2e

help:            ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── Docker environments ─────────────────────────────────────
dev-up:          ## Start dev stack (postgres+redis+minio+api+web)
	./deploy/compose.sh dev up -d --build

dev-down:        ## Stop dev stack
	./deploy/compose.sh dev down

dev-logs:        ## Follow API logs
	./deploy/compose.sh dev logs -f api

test-up:         ## Start test stack (isolated ports)
	./deploy/compose.sh test up -d --build

test-down:       ## Stop test stack
	./deploy/compose.sh test down -v

# ── Backend ─────────────────────────────────────────────────
back-test:       ## Run backend unit tests
	cd back && uv run pytest tests/unit -q

back-lint:       ## Lint backend
	cd back && uv run ruff check . && uv run ruff format --check .

back-format:     ## Format backend
	cd back && uv run ruff check --fix . && uv run ruff format .

# ── Web ─────────────────────────────────────────────────────
web-dev:         ## Run Next.js dev server locally
	cd web && npm run dev

web-build:       ## Production build of the web app
	cd web && npm run build

web-lint:        ## Lint web
	cd web && npm run lint

e2e:             ## Run Playwright e2e suite (needs test stack up)
	cd web && npx playwright test
