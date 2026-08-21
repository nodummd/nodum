---
title: "API guide: notes and files"
section: Developers
order: 2
summary: Every notes and attachments endpoint with a copy-paste request and a real response — create, read, edit safely, move, tag, upload, delete.
where: Base URL and keys live in Settings → API keys
---

Everything below assumes two shell variables:

```bash
NODUM=https://your-nodum/api/public/v1
KEY="nodum_key_…"        # Settings → API keys
```

and sends the key the same way every time: `-H "Authorization: Bearer $KEY"`.
Success is always `{"ok": true, "data": ...}`; errors are always
`{"ok": false, "error": {"code", "details", "message"}}`. **Writes return
metadata, never bodies** — reading content back needs the `read` scope.

## Find your vault

```bash
curl -H "Authorization: Bearer $KEY" $NODUM/vaults
```

```json
{ "ok": true,
  "data": [ { "id": "0198…", "name": "Second Brain",
              "created_at": "2026-08-01T09:00:00Z", "updated_at": "2026-08-21T07:00:00Z" } ] }
```

Every other call takes that `id` in the path. `GET /vaults/{id}/tree` returns
the folder/note tree (titles only, no bodies) if you want the whole shape at
once.

## Create a note — `POST /vaults/{id}/notes` *(write)*

```bash
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title": "Standup 21 Aug", "folder": "Work/Standups", "content": "- Shipped [[Public API]]\n"}' \
  $NODUM/vaults/$VAULT/notes
```

```json
{ "ok": true,
  "data": { "id": "0198…", "folder_id": "0198…", "title": "Standup 21 Aug",
            "path": "Work/Standups/Standup 21 Aug",
            "created_at": "…", "updated_at": "…" } }
```

Missing folders in `folder` are created. A duplicate path is `409
already_exists`. `[[Wikilinks]]` in the content resolve immediately.

## Read — `GET /vaults/{id}/notes/{note_id}` or `/notes/by-path?path=…` *(read)*

The full note: `content`, `properties` (parsed frontmatter), `word_count`,
plus the metadata above. `by-path` takes the exact path
(`Work/Standups/Standup 21 Aug`).

## List — `GET /vaults/{id}/notes` *(read)*

`?folder=Work&limit=50&offset=0` — metadata only, most recently updated
first, `total` for pagination:

```json
{ "ok": true, "data": { "items": [ … ], "total": 128, "limit": 50, "offset": 0 } }
```

## Edit safely — `PUT /vaults/{id}/notes/{note_id}/content` *(write)*

Three modes:

- `{"content": "...", "mode": "replace"}` — the whole body. Send
  `base_updated_at` (the `updated_at` you last read) and a stale write
  returns `409 conflict` with `details.server_updated_at` so you can merge
  instead of overwrite.
- `{"content": "New line", "mode": "append"}` — added to the end. Composed
  on the server against the current body, so two clients appending at the
  same moment both land.
- `"mode": "prepend"` — added at the top, always *below* the frontmatter.

## Rename or move — `PATCH /vaults/{id}/notes/{note_id}` *(write)*

```bash
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title": "Standup 2026-08-21", "folder": "Archive/Standups"}' \
  $NODUM/vaults/$VAULT/notes/$NOTE
```

`"folder": ""` moves to the vault root. Links pointing at the note keep
working — Nodum re-resolves them.

## Tags — `POST /vaults/{id}/notes/{note_id}/tags` *(write)*

`{"add": ["work/standup"], "remove": []}` — edits the frontmatter `tags`
list; inline `#tags` in the body are never touched.

## Delete — `DELETE /vaults/{id}/notes/{note_id}` *(delete)*

Links pointing at the deleted note become unresolved ghosts in the graph.

## Files — `/vaults/{id}/attachments`

- `POST` *(write)* — multipart, field `file`:
  `curl -F "file=@diagram.png" …/attachments`. 5 MB cap, type checked by
  content. Embed it in a note with `![[diagram.png]]`.
- `GET` *(read)* — list: `{id, filename, mime_type, size_bytes, created_at}`.
- `GET …/{attachment_id}/url` *(read)* — `{"url": …, "expires_in": 300}`, a
  time-limited download URL.
- `DELETE …/{attachment_id}` *(delete)*.

## The errors you will actually see

Errors carry `code` (branch on this), `message` (show this) and `details`
(the specifics — which field, which scope, what conflicted):

| Code | Meaning |
| --- | --- |
| `UNAUTHORIZED` (401) | Missing, mistyped or revoked key — or a password change revoked it. |
| `FORBIDDEN` (403) | The key lacks the scope; `details` names which one. |
| `NOT_FOUND` (404) | Not there — or not yours. Deliberately the same answer. |
| `ALREADY_EXISTS` (409) | A note at that path already exists. |
| `CONFLICT` (409) | Stale `base_updated_at`; `details` carries `server_updated_at=…`. |
| `VALIDATION_FAILED` (422) | Bad input; `details` names the field. |
| `RATE_LIMITED` (429) | Slow down — 300 requests/minute per key by default. |
