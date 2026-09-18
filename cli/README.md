# nodum CLI

A stdlib-only Python CLI for managing a local Nodum Docker Compose stack.

## Install

```bash
cd cli
pip install -e .        # editable (dev workflow)
pip install .            # from a built wheel
```

After install, the `nodum` command is on PATH.

## Usage

```bash
nodum stack up                      # start the dev stack
nodum stack up --env prod           # start production (needs deploy/.env.prod)
nodum stack --env prod up           # same, alternate flag order
nodum stack down                    # stop containers (keep volumes)
nodum stack down -v                 # stop + remove volumes
nodum stack restart                 # recreate containers (no rebuild by default)
nodum stack restart --build         # recreate + rebuild images
nodum stack ps                      # show container states
nodum stack logs -f api             # follow API logs
nodum stack logs web                # web container logs
nodum stack exec api uv run alembic upgrade head
nodum stack migrate --env staging   # run migrations on staging
nodum stack clean                   # stop + remove all volumes (DESTRUCTIVE)
nodum stack clean --force           # same, no prompt (dev/test only)
nodum stack reset                   # clean + remove orphan containers
nodum stack -r /opt/nodum up        # use a specific checkout
```

## What it wraps

Every command delegates to `deploy/compose.sh` under the hood, so the CLI
inherits compose.sh's engine detection (docker vs podman), environment file
resolution, and subdomain-pairing preflight checks for staging/prod.

## Phase 1 scope

This is the compose wrapper only — `nodum stack <verb>`. The top-level
`nodum <noun>` space is left free for a future API client. The CLI is
stdlib-only: no dependencies beyond the Python standard library.

## Testing

```bash
cd cli
uv run pytest tests/ -v
```
