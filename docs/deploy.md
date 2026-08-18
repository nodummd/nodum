# Deploying nodum

The deploy stack is fully containerised, including the edge proxy. Staging and
production run the *same* compose layer (`docker-compose.deploy.yml`) and
differ only in container names, image tag and published ports — so staging is
a genuine rehearsal rather than a lookalike that drifts.

```
                        ┌───────── host ─────────┐
   :80 / :443  ────────▶│  caddy                 │   the only published ports
                        │    │                   │
             ┌──────────┼────┼───── edge ────────┤
             │   web    │  api   │  minio        │
             └──────────┼────┼────┼──────────────┤
                        │  app_network           │
                        │  postgres  redis       │
                        │  redis-control         │
                        │  celery-worker/beat    │
                        └────────────────────────┘
```

Postgres and Redis are not on the edge network, so a compromised proxy has no
route to them. Nothing but Caddy binds a host port.

## 1. Prerequisites

- A Linux host with Docker Engine and the compose plugin
- DNS for your domain pointing at the host
- Ports 80 and 443 reachable (Caddy needs both for ACME and for HTTP→HTTPS)

## 2. Configure

Production and staging each need their own env file. `compose.sh` refuses to
fall back to `.env` for either — sharing one file is how a staging deploy ends
up writing to the production database.

```bash
cp deploy/.env.prod.example deploy/.env.prod
chmod 600 deploy/.env.prod          # it holds every credential you have
$EDITOR deploy/.env.prod
```

Every blank value must be filled. Generate them with:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"      # SECRET_KEY, JWT_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(24))"  # passwords
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # AI_ENCRYPTION_KEY
```

Three values decide whether the deployment works at all:

| Variable | Value | Gets it wrong how |
|---|---|---|
| `NODUM_SITE_ADDRESS` | `nodum.example.com` | A bare hostname makes Caddy obtain and renew TLS itself. `:80` serves plain HTTP with no ACME — only correct behind another terminator |
| `FRONTEND_BASE_URL` | `https://nodum.example.com` | This is the origin the browser is sent back to after Google sign-in, and the CORS origin. Point it at the API and login lands on a 404 |
| `S3_PUBLIC_URL` | see below | Where the browser fetches attachments. Wrong value = broken images, with no error at boot |

The API refuses to start on placeholder or known-default credentials
(`back/app/settings/production.py`). That is a backstop, not a substitute for
reading the file.

### Object storage

Attachments go to S3. Pick one:

**Bundled MinIO** (default, self-contained). Runs in the stack, Caddy serves it
at `/s3`, and you own its backups:

```ini
S3_PUBLIC_URL=https://nodum.example.com/s3      # your origin + /s3
MINIO_ROOT_USER=nodum
MINIO_ROOT_PASSWORD=…
```

**A managed store** — Hetzner Object Storage, AWS S3, Cloudflare R2, Backblaze.
Setting `S3_ENDPOINT_URL` makes `compose.sh` drop MinIO, its volume and its
memory budget from the stack, and hands durability to the provider:

```ini
S3_ENDPOINT_URL=https://fsn1.your-objectstorage.com
S3_PUBLIC_URL=https://fsn1.your-objectstorage.com   # must EQUAL the endpoint
S3_BUCKET_NAME=nodum
S3_REGION=fsn1
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
```

Three things worth knowing about the managed path:

- `S3_PUBLIC_URL` **must equal** `S3_ENDPOINT_URL`. The presigned URL is already
  public, so nothing rewrites it; a different value silently produces URLs that
  404. The `/s3` Caddy route just goes unused.
- `S3_REGION` is not cosmetic. SigV4 signs the region, so a wrong value fails
  every request with `SignatureDoesNotMatch`. Hetzner uses the location code
  (`fsn1`, `nbg1`, `hel1`), AWS `eu-central-1`, R2 `auto`.
- **No bucket CORS needed.** Attachments only ever land in an `<img>`/`<iframe>`
  `src`, never in a `fetch()`, so the browser never performs a preflight.

Verify which mode you are in before deploying — `compose config --services`
lists `minio` only for the bundled path.

## 3. Start

```bash
cd deploy && ./compose.sh prod up -d --build
```

Startup is ordered: Postgres and Redis come up, a one-shot `migrate` container
runs `alembic upgrade head` and exits 0, and only then do the API, worker and
beat start. Migrations live in that one container precisely because Alembic
takes no lock — having every replica migrate on boot is a race.

```bash
./compose.sh prod ps          # every service healthy
./compose.sh prod logs -f api
```

## 4. Verify

```bash
# Best against production: an account you already made, so nothing is created
# and no verification email is sent.
SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=… ./deploy/smoke.sh https://nodum.example.com

# Or, run on the deploy host, and it creates and verifies a throwaway account:
./deploy/smoke.sh https://nodum.example.com
```

With `EMAIL_VERIFICATION_REQUIRED=true` (production's default) signup returns
`verification_required` and no token — that is the API working, not failing.
Without `SMOKE_EMAIL` the script finishes verification directly in the stack's
database, which is why that form has to run on the deploy host. It also means a
real verification email is sent to a `nodumtest.dev` address that does not
exist, and every run is another hard bounce against your sending reputation —
so use `SMOKE_EMAIL` for anything but a one-off.

The script signs up a throwaway account and exercises the app end to end — including an
attachment upload and download, which is the one path a rendered
`compose config` cannot check. Attachments are served from MinIO over
presigned SigV4 URLs whose signature covers both the path and the `Host`
header, so `/s3` is easy to get subtly wrong and fails as a **403**, which
reads like a permissions bug rather than a routing one.

To rehearse the whole thing locally first, on a spare port, beside a running
dev stack:

```bash
make prod-verify        # boots prod on :8080 and runs the smoke test
```

## 5. Staging

Identical, with its own file and its own credentials:

```bash
cp deploy/.env.staging.example deploy/.env.staging
$EDITOR deploy/.env.staging
./compose.sh staging up -d --build
```

Staging defaults to ports 8080/8443 and its own image tag, so it can sit on the
same host as production without colliding. `ENVIRONMENT=staging` maps to
`ProductionSettings`, so staging gets the same strictness — including the
refusal to boot on default credentials.

## 6. Production checklist

- [ ] `deploy/.env.prod` filled, `chmod 600`, secrets generated fresh and not
      shared with staging
- [ ] `./compose.sh prod ps` — every service `healthy`, `migrate` `exited (0)`
- [ ] `./deploy/smoke.sh https://your-domain` passes, attachments included
- [ ] `docker ps` shows host ports on **caddy only**
- [ ] Backups scheduled and a restore drilled — see [backup.md](backup.md)
- [ ] Optional: `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`

Capacity knobs (`API_WORKERS`, `CELERY_CONCURRENCY`, the `*_MEM_LIMIT` and
`*_CPU_LIMIT` values) are documented in `.env.prod.example`. The memory limits
are hard caps — the kernel OOM-kills rather than swaps, so keep the total
comfortably under host RAM.

## 7. Upgrades

```bash
git pull
cd deploy && ./compose.sh prod up -d --build
```

The `migrate` container runs first and the API waits for it, so a schema change
is applied exactly once before any application container serves traffic.

## 8. TLS notes

Caddy provisions and renews certificates automatically when
`NODUM_SITE_ADDRESS` is a hostname; certificates persist in the `caddy_data`
volume, so don't delete it casually (rate limits apply upstream).

To bring your own certificate, or to add a `www` redirect, edit
`deploy/caddy/Caddyfile` — it is a normal Caddyfile, mounted read-only, and CI
validates it on every change.
