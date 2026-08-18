#!/usr/bin/env bash
# ============================================================
# Nodum — deployment smoke test
# ============================================================
#   ./smoke.sh http://localhost:8080     # a locally-verified prod stack
#   ./smoke.sh https://nodum.example.com # the real thing, after a deploy
#
# Exercises the paths a rendered `compose config` cannot: that the proxy
# actually resolves every upstream, that Postgres/Redis/MinIO are wired up,
# and above all that an attachment survives the round trip. Attachments are
# served straight from MinIO over presigned SigV4 URLs whose signature covers
# both the path and the Host header, so the /s3 route is the single easiest
# thing to get subtly wrong — and it fails as a 403, which reads like a
# permissions bug rather than a routing one.
#
# Authenticating, in order of preference:
#
#   SMOKE_EMAIL=… SMOKE_PASSWORD=… ./smoke.sh https://nodum.md
#       Logs in as an account that already exists. Best against production:
#       nothing is created and no verification email is sent. Make the account
#       once through the UI and reuse it.
#
#   ./smoke.sh https://nodum.md
#       Creates one throwaway account. Where EMAIL_VERIFICATION_REQUIRED is on
#       (production's default) signup deliberately returns no token, so the
#       script finishes verification straight in the stack's database — which
#       needs to run on the deploy host, beside compose.sh. It also means a real
#       verification email goes to SMOKE_EMAIL_DOMAIN (default nodumtest.dev,
#       which does not exist), and every run is another hard bounce against
#       your sending reputation. Use SMOKE_EMAIL for anything but a one-off.
#
# Leaves the throwaway signup behind either way.
# ============================================================
set -uo pipefail
BASE="${1:?usage: smoke.sh http://localhost:8080}"
fail=0
ok()   { echo "  ✓ $*"; }
bad()  { echo "  ✗ $*"; fail=1; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = 200 ] && ok "web served through the proxy (200)" || bad "web root returned $code"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_ENV="${SMOKE_ENV:-prod}"
PASSWORD="${SMOKE_PASSWORD:-s3cure-Password!}"

json_field() { python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(d.get('$1',''))" 2>/dev/null; }

login() {
  curl -s -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | json_field access_token
}

# Finish verification the way a mailbox would, without a mailbox: flip the flag
# in the stack's own database. Only possible beside compose.sh on the deploy
# host — the code itself is stored as an HMAC and is not recoverable.
verify_in_db() {
  local email="$1" env_file="$SCRIPT_DIR/.env.$SMOKE_ENV" pg_user=nodum pg_db=nodum
  [ -x "$SCRIPT_DIR/compose.sh" ] || return 1
  if [ -f "$env_file" ]; then
    pg_user=$(grep -E '^POSTGRES_USER=' "$env_file" | tail -1 | cut -d= -f2-)
    pg_db=$(grep -E '^POSTGRES_DB=' "$env_file" | tail -1 | cut -d= -f2-)
  fi
  "$SCRIPT_DIR/compose.sh" "$SMOKE_ENV" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "${pg_user:-nodum}" -d "${pg_db:-nodum}" \
    -c "UPDATE users SET email_verified = true WHERE email = '$email';" >/dev/null 2>&1
}

if [ -n "${SMOKE_EMAIL:-}" ]; then
  EMAIL="$SMOKE_EMAIL"
  TOKEN=$(login "$EMAIL" "$PASSWORD")
  [ -n "$TOKEN" ] && ok "logged in as $EMAIL (no account created)" \
    || { bad "login failed for $EMAIL — check SMOKE_EMAIL/SMOKE_PASSWORD"; exit 1; }
else
  EMAIL="smoke-$RANDOM$RANDOM@${SMOKE_EMAIL_DOMAIN:-nodumtest.dev}"
  signup=$(curl -s -X POST "$BASE/api/v1/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke\"}")
  TOKEN=$(printf '%s' "$signup" | json_field access_token)

  if [ -n "$TOKEN" ]; then
    ok "signup through /api (token issued)"
  elif [ "$(printf '%s' "$signup" | json_field status)" = "verification_required" ]; then
    # Not a failure: the account exists, the code row was written, and a
    # provider accepted the message — signup 502s when none of them do.
    ok "signup through /api (verification required, code issued)"
    case "$SMOKE_ENV" in
      prod|staging)
        echo "      ↳ that mailed a real code to $EMAIL, a domain that does not exist."
        echo "        Every run is another hard bounce — use SMOKE_EMAIL for anything but a one-off." ;;
    esac
    if verify_in_db "$EMAIL"; then
      TOKEN=$(login "$EMAIL" "$PASSWORD")
      [ -n "$TOKEN" ] && ok "verified in the database, logged in" || bad "login after verifying failed"
    else
      bad "cannot finish verification from here (no compose stack on this host)."
      echo "      Run this on the deploy host, or: SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=… $0 $BASE"
      exit 1
    fi
  else
    bad "signup failed: ${signup:0:200}"; exit 1
  fi
fi
[ -n "$TOKEN" ] || exit 1
AUTH="Authorization: Bearer $TOKEN"

VAULT=$(curl -s "$BASE/api/v1/vaults" -H "$AUTH" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])')
[ -n "$VAULT" ] && ok "welcome vault seeded ($VAULT)" || bad "no vault"

note=$(curl -s -X POST "$BASE/api/v1/vaults/$VAULT/notes" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke note","content":"linked to [[Welcome to Nodum]]\n"}')
echo "$note" | grep -q '"data"' && ok "note created" || bad "note create failed: ${note:0:200}"

# search exercises Postgres FTS through the API
s=$(curl -s "$BASE/api/v1/vaults/$VAULT/search?q=Smoke" -H "$AUTH")
echo "$s" | grep -q '"total"' && ok "search round-trip" || bad "search failed: ${s:0:160}"

# graph exercises the Redis cache path
g=$(curl -s "$BASE/api/v1/vaults/$VAULT/graph" -H "$AUTH")
echo "$g" | grep -q '"nodes"' && ok "graph (redis cache path)" || bad "graph failed: ${g:0:160}"

# ── the load-bearing one: attachment upload + fetch via the /s3 proxy route ──
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > /tmp/smoke.png
up=$(curl -s -X POST "$BASE/api/v1/vaults/$VAULT/attachments" -H "$AUTH" -F "file=@/tmp/smoke.png;type=image/png")
AID=$(printf '%s' "$up" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)
[ -n "$AID" ] && ok "attachment uploaded to object storage ($AID)" || { bad "upload failed: ${up:0:250}"; exit 1; }

URL=$(curl -s "$BASE/api/v1/vaults/$VAULT/attachments/$AID/url" -H "$AUTH" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d["url"] if isinstance(d,dict) else d)' 2>/dev/null)
echo "    presigned: ${URL:0:80}..."
case "$URL" in
  "$BASE"/s3/*)
    ok "presigned URL points at the bundled MinIO via the /s3 route" ;;
  http://*|https://*)
    # A managed store (Hetzner, S3, R2) presigns its own public endpoint, so
    # the URL is off-origin by design and nothing proxies it.
    ok "presigned URL points at an external object store" ;;
  *)
    bad "presigned URL is not absolute: $URL" ;;
esac

# -o, not stdout capture: the payload is binary and shell/sed mangle it.
dlcode=$(curl -s -o /tmp/smoke-dl.png -w '%{http_code}' "$URL")
if [ "$dlcode" = 200 ]; then
  if cmp -s /tmp/smoke.png /tmp/smoke-dl.png; then ok "attachment downloaded from its presigned URL, bytes identical"
  else bad "attachment bytes differ ($(wc -c </tmp/smoke.png) sent vs $(wc -c </tmp/smoke-dl.png) received)"; fi
else
  bad "attachment download returned $dlcode (SigV4 covers Host+path — check the /s3 route, or S3_REGION for a managed store)"
fi

echo
[ $fail -eq 0 ] && echo "  RESULT: all checks passed" || echo "  RESULT: FAILURES"
exit $fail
