# Deploying nodum

Reference deployment for a single host running the prod compose stack behind
Caddy with automatic TLS, serving `nodum.md`.

## 1. Prerequisites

- A Linux host with Docker Engine + the compose plugin
- DNS: `nodum.md` (and optionally `www.nodum.md`) pointing at the host
- Ports 80/443 reachable from the internet — everything else stays loopback:
  every compose port binding is `127.0.0.1:…`, so only the reverse proxy is
  exposed

## 2. Configure secrets

```bash
cp deploy/.env.example deploy/.env
```

Fill every `:?set in deploy/.env` variable — Postgres credentials, MinIO
credentials, `SECRET_KEY`, `JWT_SECRET_KEY` (long random strings, e.g.
`openssl rand -hex 48`), and `NEXT_PUBLIC_API_BASE_URL=https://nodum.md`.
`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are optional — leave them empty to run
without Sentry.

`deploy/.env` is gitignored. Never commit it.

## 3. Start the stack

```bash
cd deploy && ./compose.sh prod up -d --build
```

This brings up Postgres (pgvector), Redis, MinIO, the API (which runs alembic
migrations on boot), a Celery worker+beat, and the web app. Health-gated
`depends_on` ordering means `docker compose ps` shows everything `healthy`
when the stack is actually ready.

## 4. Caddy reference config

`/etc/caddy/Caddyfile`:

```caddyfile
nodum.md {
	encode zstd gzip

	# API + auth cookies — path-scoped to /api
	handle /api/* {
		reverse_proxy 127.0.0.1:8000
	}

	# Everything else is the Next.js app
	handle {
		reverse_proxy 127.0.0.1:3000
	}

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
}

www.nodum.md {
	redir https://nodum.md{uri} permanent
}
```

Caddy provisions and renews TLS automatically. Reload with
`systemctl reload caddy`.

Nginx equivalent: proxy `/api/` to `127.0.0.1:8000` and `/` to
`127.0.0.1:3000`; forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.

## 5. Production checklist

- [ ] `deploy/.env` filled; secrets generated fresh, never reused from dev
- [ ] `docker compose ps` — all services `healthy`
- [ ] `curl -s https://nodum.md/api/v1/../../health` → `"status": "healthy"`
      (the health endpoint is served at `/health` on the API container;
      expose it through the proxy only if you want it public)
- [ ] Signup → create note → search round-trip works in a browser
- [ ] Redis: for real traffic, raise `--maxmemory` (1gb+) and run a second
      instance with `noeviction` for `REDIS_CONTROL_URL`
      (see comments in `deploy/docker-compose.yml`)
- [ ] Backups scheduled and restore drilled — see [backup.md](backup.md)
- [ ] Optional: set `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`

## 6. Upgrades

```bash
git pull
cd deploy && ./compose.sh prod up -d --build
```

Migrations run automatically on API boot. Ship `main` only — `dev` is the
integration branch.
