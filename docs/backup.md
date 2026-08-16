# Backups & restore

Two things hold user data: **Postgres** (notes, links, versions, auth) and
**MinIO** (attachments). Redis is cache/control state and needs no backup.

## Postgres — nightly pg_dump

```bash
#!/usr/bin/env bash
# /usr/local/bin/nodum-backup-db.sh — run from cron/systemd-timer nightly
set -euo pipefail
STAMP=$(date +%F)
BACKUP_DIR=/var/backups/nodum
mkdir -p "$BACKUP_DIR"
deploy/compose.sh prod exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$BACKUP_DIR/nodum-$STAMP.dump"
# keep 14 nightly dumps
ls -1t "$BACKUP_DIR"/nodum-*.dump | tail -n +15 | xargs -r rm
```

`-Fc` (custom format) allows selective, parallel restore. Ship the dump
off-host (rsync/rclone to object storage) — a backup on the same disk is not
a backup.

## MinIO — attachment mirror

```bash
#!/usr/bin/env bash
# /usr/local/bin/nodum-backup-minio.sh
set -euo pipefail
# mc alias set nodum http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"  (once)
mc mirror --overwrite nodum/nodum-attachments /var/backups/nodum/attachments
```

`mc mirror` is incremental. Sync the mirror directory off-host with the same
rclone/rsync job as the DB dumps.

## Restore drill (do this before you need it)

1. **Fresh stack, empty volumes:**
   ```bash
   cd deploy && ./compose.sh prod down -v && ./compose.sh prod up -d postgres minio
   ```
2. **Database:**
   ```bash
   deploy/compose.sh prod exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     --clean --if-exists < /var/backups/nodum/nodum-<date>.dump
   ```
3. **Attachments:**
   ```bash
   mc mirror --overwrite /var/backups/nodum/attachments nodum/nodum-attachments
   ```
4. **Bring the rest up:** `./compose.sh prod up -d`
5. **Verify:** log in with a real account, open a note with an attachment,
   check version history renders, run a search.

Time the drill; if restore takes longer than your tolerated downtime, revisit
the plan. Re-run the drill after any schema-affecting release.

## What to monitor

- Dump file size trend (sudden shrink = failed dump)
- `pg_restore --list` on a fresh dump (integrity check without a full restore)
- Off-host sync job exit codes
