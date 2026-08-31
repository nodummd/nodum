# ============================================================
# Nodum — Development Makefile
# ============================================================

.PHONY: help dev-up dev-down dev-logs test-up test-down back-test back-test-int back-lint back-format \
        web-dev web-build web-lint web-typecheck e2e e2e-up e2e-down e2e-status verify

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

# ── Deployments ─────────────────────────────────────────────
# Staging and production run the same compose layer, so staging is a real
# mirror. Each needs its own env file — see deploy/.env.{staging,prod}.example.
staging-up:      ## Start staging stack (needs deploy/.env.staging)
	./deploy/compose.sh staging up -d --build

staging-down:    ## Stop staging stack
	./deploy/compose.sh staging down

staging-logs:    ## Follow staging API logs
	./deploy/compose.sh staging logs -f api

prod-up:         ## Start production stack (needs deploy/.env.prod)
	./deploy/compose.sh prod up -d --build

prod-down:       ## Stop production stack
	./deploy/compose.sh prod down

prod-logs:       ## Follow production API logs
	./deploy/compose.sh prod logs -f api

prod-verify:     ## Boot production locally on :8080 and smoke-test it end to end
	NODUM_HTTP_PORT=8080 NODUM_HTTPS_PORT=8081 ./deploy/compose.sh prod up -d --build
	./deploy/smoke.sh http://localhost:8080

# ── Backend ─────────────────────────────────────────────────
back-test:       ## Run backend unit tests
	cd back && uv run pytest tests/unit -q

back-test-int:   ## Run backend integration tests (needs infra up)
	cd back && uv run pytest tests/integration -q

back-lint:       ## Lint backend (check + format check — same gate as CI)
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

web-typecheck:   ## Typecheck web (tsc --noEmit)
	cd web && npm run typecheck

web-image-check: ## Nothing that ships in the web image imports a .dockerignored path
	cd web && node scripts/check-docker-context.mjs

e2e-up:          ## Start the stack the e2e suite expects (mirrors CI)
	./deploy/e2e-stack.sh up

e2e-down:        ## Stop it
	./deploy/e2e-stack.sh down

e2e-status:      ## What is running
	./deploy/e2e-stack.sh status

e2e:             ## Run Playwright e2e suite (run `make e2e-up` first)
	cd web && BASE_URL=$${BASE_URL:-http://127.0.0.1:3100} npx playwright test

# ── Gates ───────────────────────────────────────────────────
verify:          ## Everything CI runs, minus e2e — run before you push
	$(MAKE) back-lint
	$(MAKE) back-test
	$(MAKE) web-typecheck
	$(MAKE) web-image-check
	$(MAKE) web-lint
	$(MAKE) web-build


# ── Utilities ─────────────────────────────────────────────────────
.PHONY: claude
claude: ## Run Claude Code with permission prompts skipped
	@claude --dangerously-skip-permissions