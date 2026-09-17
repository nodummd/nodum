---
name: nodum-deploy
description: Running, deploying, or debugging the nodum docker stack (deploy/) — compose environments, port maps, prod verification flow, image build gotchas (.dockerignore, build-time rewrites, non-root uv), and secrets rules. Use for anything involving docker, compose, images, or environments.
---

# Nodum Deploy

`deploy/compose.sh {dev|test|prod} <compose args>` — docker or podman.
Base `docker-compose.yml` (postgres16+pgvector, redis 7.4, minio) + per-env
overrides. ALL host ports bind 127.0.0.1.

## Port map (chosen to coexist with the hourly project's stack)

| Service | dev | test | prod-verify |
|---------|-----|------|-------------|
| postgres | 15432 | 55432 | 25432 |
| redis | 16379 | 56379 | 26379 |
| minio | 19000/19001 | 59000/1 | 29000/1 |
| api | 8000 | 58000 | 18000 |
| web | 3000 (dev srv: 3100) | — | 13000 |

## Prod verification (the release gate)

```bash
cd deploy   # needs a real .env (python3 -c "import secrets; print(secrets.token_hex(32))")
set -a && source .env && set +a
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  -f docker-compose.verify.yml --project-name nodum-verify up -d --build
curl localhost:18000/health && curl localhost:13000/   # then signup via :13000/api/v1
docker compose ... --project-name nodum-verify down -v
```

## Image gotchas (each one broke prod once — keep them fixed)

- `.dockerignore` in back/ and web/ MUST exclude `.venv`, `.env*`,
  `node_modules`, `.next` — a stray local venv breaks the image and a copied
  `.env` leaks secrets into a public image.
- Next standalone inlines rewrites AT BUILD TIME: the api proxy target is the
  `API_PROXY_URL` **build arg** (compose passes `http://api:8000`). Runtime
  env does nothing for rewrites.
- The api image runs as non-root `nodum` (no home): `UV_NO_SYNC=1` +
  `UV_CACHE_DIR=/tmp/uv-cache` are required or uv crashes on boot.
- Celery runs with `-B` (beat): nightly `tasks.prune_sessions`.
- ProductionSettings refuses placeholder/short SECRET_KEY & JWT_SECRET_KEY —
  prod boot failures with "is unset or a placeholder" mean the .env is bad.

## Secrets rules (public repo)

Only `deploy/.env.example` is committed. Real `.env` files are gitignored;
gitleaks CI scans every push. Rate limiting in prod behind a proxy needs
`TRUST_PROXY_HEADERS=true`.
