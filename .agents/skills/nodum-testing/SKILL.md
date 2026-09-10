---
name: nodum-testing
description: Running and extending nodum's test suites — backend pytest layout and fixtures, Playwright e2e conventions and helpers, what needs live infra, and the flakiness rules (event loops, cookie jars, timing). Use when writing tests or diagnosing failures.
---

# Nodum Testing

Two suites, both must be green before any merge:
- **Backend** (42): `cd back && uv run pytest tests -q` — integration tests hit
  the real dev infra (postgres 15432 / redis 16379 / minio 19000) via
  `./deploy/compose.sh dev up -d postgres redis minio`.
- **E2E** (18): `cd web && npx playwright test` — needs api on :8000
  (`uv run uvicorn app.main:app --reload`) and web on :3100
  (`PORT=3100 npm run dev`). Override target with `BASE_URL`.

## Backend conventions

- `tests/conftest.py`: httpx `ASGITransport` client (no network); a
  session-scoped autouse fixture creates the S3 bucket (lifespan doesn't run).
- Event loops are **session-scoped** (`asyncio_default_test_loop_scope` +
  fixture scope in pyproject) — the app's global engine pools connections
  that must not cross loops. Never change this to function scope.
- Each test signs up a fresh unique user (`{prefix}-{uuid}@nodumtest.dev` —
  `.test` TLD is rejected by the email validator). After signup call
  `client.cookies.clear()` — the httpx jar otherwise wins over body tokens
  in refresh flows.
- Integration files are per-domain: test_auth, test_vaults_notes,
  test_links_graph, test_search_tags, test_attachments,
  test_daily_templates, test_import_export.

## E2E conventions

- Helpers in `e2e/helpers.ts`: `signupFreshUser(page, prefix)`,
  `openNoteFromExplorer`, `editorSurface` (the `.cm-content` locator).
- Typing into CM6: click `editorSurface(page)` then `page.keyboard.type`;
  autosave needs `waitForTimeout(1200)` (700ms debounce + save).
- Dialogs: `page.getByRole("dialog")`; the switcher creates on
  `Create “name”` click. Playwright key name is `ControlOrMeta+…`.
- `workers: 1` — scenarios share the backend; keep it.
- Dev-overlay clicks: `devIndicators: false` is set in next.config for a
  reason (the floating badge intercepted ribbon clicks).

## CI

`ci-backend` (lint+unit), `ci-web` (lint+build), `ci-e2e` (full stack via
GH services + Playwright, traces uploaded on failure), `secret-scan`
(gitleaks). All defined in `.github/workflows/`.
