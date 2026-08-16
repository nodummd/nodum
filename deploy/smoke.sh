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
# Creates one throwaway account. Safe against staging; against production it
# leaves a signup behind.
# ============================================================
set -uo pipefail
BASE="${1:?usage: smoke.sh http://localhost:8080}"
fail=0
ok()   { echo "  ✓ $*"; }
bad()  { echo "  ✗ $*"; fail=1; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = 200 ] && ok "web served through the proxy (200)" || bad "web root returned $code"

EMAIL="smoke-$RANDOM$RANDOM@nodumtest.dev"
signup=$(curl -s -X POST "$BASE/api/v1/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"s3cure-Password!\",\"name\":\"Smoke\"}")
TOKEN=$(printf '%s' "$signup" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])' 2>/dev/null)
[ -n "$TOKEN" ] && ok "signup through /api (token issued)" || { bad "signup failed: ${signup:0:200}"; exit 1; }
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
