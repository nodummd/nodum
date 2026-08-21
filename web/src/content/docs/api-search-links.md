---
title: "API guide: search, links & graph"
section: Developers
order: 3
summary: Full-text search with operators, fuzzy title matching, linking and unlinking notes, backlinks, tags and the knowledge graph — each with a working request.
where: Base URL and keys live in Settings → API keys
---

Same setup as the [notes guide](/docs/api-notes): `$NODUM` is the base URL,
`$KEY` the API key, and every endpoint here needs only the `read` scope
unless marked *(write)*.

## Search — `GET /vaults/{id}/search`

```bash
curl -H "Authorization: Bearer $KEY" \
  "$NODUM/vaults/$VAULT/search?q=spaced%20repetition&limit=20"
```

```json
{ "data": { "query": "spaced repetition", "total": 7,
  "results": [ { "id": "0198…", "title": "Learning", "path": "Topics/Learning",
                 "snippet": "…the case for <mark>spaced</mark> <mark>repetition</mark>…",
                 "rank": 0.61, "created_at": "…", "updated_at": "…" } ] } }
```

The query language is the app's: `path:Folder` and `file:Name` narrow,
`tag:#name` filters by tag, `-word` excludes, `"a phrase"` matches exactly.
`sort` is `relevance` (default), `updated`, `created` or `title`;
`limit`/`offset` paginate with an honest `total`.

## Fuzzy titles — `GET /vaults/{id}/quick-switch?q=lear`

What ⌘O uses: cheap fuzzy matching over titles and frontmatter aliases —
`[{id, title, path, score, alias?}]`. Empty `q` returns the most recent
notes. Use it to resolve half-remembered names before a precise call.

## Link two notes — `POST /vaults/{id}/notes/{note_id}/links` *(write)*

```bash
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"target": "Topics/Learning"}' \
  $NODUM/vaults/$VAULT/notes/$NOTE/links
```

```json
{ "data": { "from": "0198…", "to": "0198…",
            "inserted": "- [[Learning]]", "already_linked": false } }
```

`target` is an id, a path, or an exact title. Already linked? Nothing is
written and `already_linked` is `true` — safe to retry. `context` puts the
link in a sentence: `{"target": "…", "context": "Follows from {link}."}`.
When two notes share a title the API writes the path form (`[[Topics/…]]`)
— and if you *say* only the ambiguous title, it answers `422` naming a path
rather than guessing.

## Unlink — `DELETE /vaults/{id}/notes/{note_id}/links?target=…` *(write)*

Links *are* the `[[wikilinks]]` in the markdown, so unlinking edits the
markdown: every prose link that unambiguously means the target is spliced
out, and `{"removed": n}` says how many. Embeds (`![[…]]`) and links inside
code are content, not connections — they stay. `removed: 0` still succeeds.

## Reading the connections

- `GET …/notes/{id}/backlinks` — who links *here*:
  `{"backlinks": [{note_id, title, path, count, snippets: ["…the sentence around the link…"]}]}`.
- `GET …/notes/{id}/links` — links *from* here, resolved and unresolved.
- `GET …/notes/{id}/unlinked-mentions` — notes that mention this title
  without linking it: the "you should probably link these" list.

## Tags

- `GET /vaults/{id}/tags` — `[{name, count}]`, most used first.
- `GET /vaults/{id}/tags/{name}` — notes carrying a tag; nested tags match
  by prefix, so `projects` also finds `projects/api`.

## The graph

- `GET /vaults/{id}/graph` — the whole vault: `nodes` (notes and
  unresolved `ghost:` targets, with degree and tags) and `edges` as
  node-index pairs — the same data the in-app graph draws.
- `GET /vaults/{id}/notes/{note_id}/graph?depth=2` — the neighborhood
  around one note, 1–5 hops.

## Ask the vault — `POST /vaults/{id}/ai/ask` *(ai)*

```bash
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"message": "Summarise what my notes say about spaced repetition."}' \
  $NODUM/vaults/$VAULT/ai/ask
```

Answers with `{conversation_id, title, reply, provider, model, actions}` —
`reply` is markdown, `actions` lists any notes the assistant created or
edited, and `conversation_id` continues the thread on the next call. Uses
the provider configured in Settings → AI (none configured → `404`). The
tool loop can take a while; give your client 120 s. And note the scope's
teeth: the assistant's tools can *write*, so an `ai` key can change a vault
even without `write`.
