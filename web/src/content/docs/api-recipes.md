---
title: "API recipes"
section: Developers
order: 4
summary: Small working programs on top of the API — a shell capture alias, a Python daily-digest bot, a JavaScript backlink janitor — ready to paste and adapt.
where: Each recipe says which scopes its key needs
---

Three complete programs, smallest first. Each one runs as-is once you fill
in the two constants at the top. Mint a key with **only the scopes the
recipe names** — least privilege is one checkbox away.

## 1. Capture from anywhere (shell · scopes: `read`, `write`)

An `inbox` command that appends a thought to today's inbox note — creating
it the first time — from any terminal:

```bash
# ~/.zshrc
NODUM=https://your-nodum/api/public/v1
NODUM_KEY="nodum_key_…"          # read + write
NODUM_VAULT="<vault id>"

inbox() {
  local day=$(date +%Y-%m-%d) body="- $*"
  local id=$(curl -s -H "Authorization: Bearer $NODUM_KEY" \
      "$NODUM/vaults/$NODUM_VAULT/notes/by-path?path=Inbox/$day" | python3 -c \
      'import json,sys;d=json.load(sys.stdin);print(d.get("data",{}).get("id",""))')
  if [ -z "$id" ]; then
    curl -s -H "Authorization: Bearer $NODUM_KEY" -H "Content-Type: application/json" \
      -d "{\"title\": \"$day\", \"folder\": \"Inbox\", \"content\": \"$body\"}" \
      "$NODUM/vaults/$NODUM_VAULT/notes" >/dev/null
  else
    curl -s -X PUT -H "Authorization: Bearer $NODUM_KEY" -H "Content-Type: application/json" \
      -d "{\"content\": \"$body\", \"mode\": \"append\"}" \
      "$NODUM/vaults/$NODUM_VAULT/notes/$id/content" >/dev/null
  fi
}
```

`inbox call the plumber` → one more line in today's inbox, from any shell.

## 2. A morning digest, written by your vault (Python · scopes: `read`, `ai`, `write`)

Asks the vault's AI for a summary of yesterday's edits and files it as a
note — run it from cron:

```python
#!/usr/bin/env python3
import datetime, json, urllib.request

NODUM = "https://your-nodum/api/public/v1"
KEY   = "nodum_key_…"          # read + ai + write
VAULT = "<vault id>"

def call(method, path, body=None):
    req = urllib.request.Request(
        f"{NODUM}{path}", method=method,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=180) as r:   # ai/ask can be slow
        return json.load(r)["data"]

yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
recent = call("GET", f"/vaults/{VAULT}/notes?limit=20")
edited = [n["title"] for n in recent["items"] if n["updated_at"][:10] == yesterday]

answer = call("POST", f"/vaults/{VAULT}/ai/ask", {
    "message": "Write a five-line digest of what changed in these notes yesterday: "
               + ", ".join(edited) if edited else "Say the vault was quiet yesterday."})

call("POST", f"/vaults/{VAULT}/notes", {
    "title": f"Digest {yesterday}", "folder": "Digests",
    "content": answer["reply"]})
print("filed", f"Digests/Digest {yesterday}")
```

## 3. A backlink janitor (Node.js · scopes: `read`, `write`)

Finds notes that *mention* a hub note without linking it, and links them:

```js
#!/usr/bin/env node
const NODUM = "https://your-nodum/api/public/v1";
const KEY = "nodum_key_…"; // read + write
const VAULT = "<vault id>";
const HUB = "Projects/Alpha"; // the note that should be linked from everywhere

const api = async (method, path, body) => {
  const r = await fetch(`${NODUM}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error.message);
  return j.data;
};

const hub = await api("GET", `/vaults/${VAULT}/notes/by-path?path=${encodeURIComponent(HUB)}`);
const { unlinked_mentions } = await api("GET", `/vaults/${VAULT}/notes/${hub.id}/unlinked-mentions`);
for (const m of unlinked_mentions ?? []) {
  const res = await api("POST", `/vaults/${VAULT}/notes/${m.note_id}/links`, { target: hub.id });
  console.log(res.already_linked ? "already" : "linked", m.path);
}
```

## Habits that keep these robust

- **One key per program**, named after it, with only the scopes it needs —
  revoking one never breaks the others.
- **Treat 409 as information**: `already_exists` means create-once logic can
  be a plain retry; `conflict` means re-read, merge, re-send.
- **Remember the password rule**: changing or resetting the account password
  revokes every key. Cron jobs fail with `401` — mint fresh keys after.
- The [interactive reference](/api-reference) shows every endpoint with
  generated snippets in more languages — paste a key and try calls live.
