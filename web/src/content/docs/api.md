---
title: API — connect your own apps
section: Developers
order: 1
summary: Create an API key and drive your vaults from any language over plain REST — list, search, read, write, link, unlink, tag, graph, even ask the AI.
where: Settings → API keys for the key and a ready-made curl
---

## What it is

Everything the app can do to a vault, as a plain REST API: list and read
notes, create and edit them, search, link and unlink, tags, the graph,
attachments — and asking your vault questions through the AI provider you
configured. It is how a script, a cron job, a phone shortcut, or your own
product talks to Nodum.

[MCP](/docs/mcp) is for AI clients that speak a protocol; this API is for
**programs you write**. Same rules, same ownership checks, different door.

## Setting it up

1. Settings → **API keys**. Copy the **base URL** — this site's address plus
   `/api/public/v1`.
2. **Create a key**: name it after the program it is for, tick what it may do
   (the scopes), create. The key is shown once; copy it.
3. The **Try it** box now holds a working `curl` with your key filled in —
   paste it into a terminal and you have made your first API call.

![Create an API key in Settings — scopes, the key shown once, and a ready-made curl.](/docs/settings-api-keys.png)

A key is a password for one program: treat it like one. Revoke it on this
screen when the program goes; it stops working on its next call. **Changing
or resetting your password revokes every key** — mint new ones afterwards.

## The 60-second start

```bash
curl -H "Authorization: Bearer nodum_key_…" \
  https://your-nodum/api/public/v1/vaults
```

Take a vault `id` from the answer and go:

```bash
# Search it
curl -H "Authorization: Bearer nodum_key_…" \
  "https://your-nodum/api/public/v1/vaults/<vault_id>/search?q=reading"

# Create a note (folders are created as needed)
curl -H "Authorization: Bearer nodum_key_…" -H "Content-Type: application/json" \
  -d '{"title": "From the API", "folder": "Inbox", "content": "Linked to [[Reading list]]."}' \
  https://your-nodum/api/public/v1/vaults/<vault_id>/notes
```

Every success is `{"data": ...}`; every error is
`{"error": {"code", "message"}}` with a stable `code`.

## Scopes

| Scope | What the key may do |
| --- | --- |
| `read` | List and read vaults, notes, links, tags, search, the graph. |
| `write` | Create and edit notes, link and unlink, tag, upload attachments. Write responses return metadata (id, path, timestamps) — never note bodies. |
| `delete` | Delete notes and attachments. |
| `ai` | Ask the vault questions. The AI's tools can also *write* notes — an `ai` key can change a vault even without `write`. |

A key without a scope gets `403` naming the missing one. Reads a key cannot
see — and anything that is not yours — are the same `404`: the API never
confirms what exists outside the key's reach.

## The interactive reference

The full reference — every endpoint, schema, and error, with a **try-it
client** — lives at [/api-reference](/api-reference). Paste a key into its
Auth box and requests run from the page, against your own vaults, with
generated snippets for shell, Python, JavaScript and more.

![The interactive API reference: endpoints on the left, schemas and a try-it client on the right.](/docs/api-reference.png)

## Going deeper

Two guides walk every endpoint with copy-paste requests and real responses:
[working with notes and files](/docs/api-notes) and
[search, links, tags and the graph](/docs/api-search-links) — and
[recipes](/docs/api-recipes) turns them into small working programs.

## Worth knowing

- **Addressing notes** — most endpoints take the note's `id`; `by-path` reads
  by exact path, and link targets accept an id, a path (`"Projects/Alpha"`)
  or an exact title. When two notes share a title, the API asks for the path
  rather than guessing.
- **Note lists and search paginate** — `limit` + `offset` in, `total` out.
  Capped collections (tags, attachments) return whole; quick-switch returns
  the top matches.
- **Concurrent edits** — send `base_updated_at` when replacing content; a
  stale write returns `409` with `details.server_updated_at` so you can merge
  instead of overwrite. `append`/`prepend` compose on the server against the
  current body, so two concurrent appends both land (prepend stays below the
  frontmatter).
- **Unlink edits markdown** — links *are* the `[[wikilinks]]` in the text, so
  unlinking splices them out. Only forms that unambiguously mean the target
  are touched (its path, a unique title, an alias no other note claims) — a
  namesake's links are safe. Embeds (`![[…]]`) and links inside code are
  content and stay — an embed keeps counting as a link until you edit it out.
  `removed: 0` still succeeds.
- **AI answers take time** — `POST …/ai/ask` runs the whole tool loop before
  answering; give your client a generous timeout (120s+).
- **Rate limits** — each key gets its own budget (300 requests/minute by
  default); over it is `429`.
- **Up to 10 live keys** per account, listed with only their last four
  characters — the full key exists in the create response and nowhere else.

## What it cannot do

Nothing outside the key's account: every call resolves to you and goes
through the same ownership checks as the app. There is no way to reach
another user's vault, and no way to manage keys, change a password, or
delete an account through the public API — that stays in the app.
