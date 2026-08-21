# Nodum Community — Architecture & Sprint Plan

Platform-global forum under `/community`, tied to existing Nodum accounts, publicly readable for SEO, shipped in a chained-branch sprint. Grounded entirely in the surveyed codebase.

---

## 1. v1 Scope

| Feature | In/Out | Rationale |
|---|---|---|
| 5 fixed categories (Announcements, Help, Bug Reports, Feature Requests, Showcase) | **IN** | Discourse's real value at small scale; seeded in the migration, staff-post-only flag on Announcements. No subcategories, no tags — Obsidian's forum itself keeps categories flat and workflow-shaped. |
| Topics + markdown replies, permalinks `/t/{id}/{slug}` | **IN** | Core. ID-first URLs survive title edits. |
| Likes (one per user/post) | **IN** | One table powers both "likes" and FR voting (Obsidian's own pattern). No daily quotas. |
| Pin / lock / soft-delete (staff), edit + delete own posts | **IN** | Moderation floor. Soft delete keeps `post_number` continuity and "removed" placeholders. |
| Report post → staff queue | **IN** | Single reason+detail row, open/resolved status. No flag-type taxonomy, no auto-hide thresholds. |
| Unread tracking (`last_read_post_number` per user/topic) | **IN** | The cheap 80% of Discourse read-tracking: unread chips + resume position, written on topic view, not scroll telemetry. |
| Full-text search (topics + posts) | **IN** | Exact clone of the notes FTS pattern (Computed tsvector + GIN). Category filter only, no operator grammar v1. |
| Latest + Top(week/month/all) + per-category lists | **IN** | "See activity" requirement. Top = filter `last_post_at >= window`, order by `reply_count` — no scoring engine. |
| Public profiles `/u/{id}` | **IN** | `name` + `avatar_url` + join date + denorm-free stats from indexed queries. No handles/bio — `users` has neither; profile is keyed by UUID. |
| View counts | **IN** | Redis-batched, never per-request DB writes. |
| Per-action rate limits + content caps | **IN** | Static throttles (5 topics/hr, 30 replies/hr, 30s gap) replace Discourse's entire trust-level engine. |
| Solved answers | **OUT (v2)** | Not in owner requirements; it's one nullable FK + one endpoint later — cheap to add when Help traffic justifies it. |
| Notifications / mentions / bell | **OUT (v2)** | No notification infra exists anywhere (report: auth-models §7); building a table+polling is a full sprint on its own. |
| Trust levels, badges, PMs, wiki posts, whispers, watch/track/mute ladder, revision diff viewer, tags, split/merge, email digests | **OUT (forever/v2)** | Machinery for managing strangers at megaforum scale; Nodum forum users are authenticated product accounts. TL automation is Discourse's largest complexity sink. |
| Image upload in posts | **OUT (v1)** | No community attachment store; remote `img` blocked for tracking-pixel/IP-leak reasons, so v1 posts are text+code+links. |
| Wikilinks / `%%comments%%` / mermaid in posts | **OUT** | Wikilink targets are vault-private; `%%` stripping eats "100%% sure"; mermaid = 1.5MB bundle + CVE surface for stranger content. |

---

## 2. Data Model — migration `0021_community.py` (revision "0021", down_revision "0020")

One migration, new package `back/app/models/community/`. All models use `UUIDMixin` (UUIDv7 — time-sortable) + `TimestampMixin`. House style: `PG_UUID(as_uuid=True)` FKs with explicit `ondelete`, named constraints in `__table_args__`.

**`users` (alter)**
- ADD `is_staff` Boolean NOT NULL server_default "false" — matches `is_active`/`email_verified` styling (user.py:25-26). Column is truth; a one-time `COMMUNITY_BOOTSTRAP_STAFF_EMAIL` env read at startup flips the first row (env as bootstrap, column as truth). Rides the existing `/auth/me` payload so the frontend gates staff UI.

**`community_categories`**
- `name` String(100), `slug` String(100) UNIQUE (`uq_community_categories_slug`), `description` Text nullable, `position` Integer NOT NULL, `is_staff_only_posting` Boolean default false
- `topic_count` Integer server_default "0", `post_count` Integer server_default "0" — maintained transactionally by community_service on topic/post create + soft-delete (atomic `UPDATE … SET x = x ± 1`)
- Seeded in the migration (5 rows). Global — deliberately NOT vault-scoped.

**`community_topics`**
- `category_id` FK `community_categories.id` ondelete CASCADE
- `author_id` FK `users.id` ondelete **SET NULL**, nullable — account deletion hard-CASCADEs users today (account_service.py:96); SET NULL keeps threads readable as "deleted user" instead of vaporizing discussions
- `title` String(300), `slug` String(300) (non-unique; URL is id-first)
- `is_pinned`, `is_locked`, `is_deleted` Boolean default false
- `reply_count` Integer server_default "0" (replies, excludes OP; decremented on reply soft-delete)
- `last_post_number` Integer server_default "1" (monotonic, never decremented — assigns `post_number` safely across soft-deletes)
- `view_count` Integer server_default "0" (Redis-flushed only)
- `last_post_at` timestamptz NOT NULL default now, `last_post_author_id` FK users SET NULL nullable
- `title_tsv` TSVECTOR `Computed("to_tsvector('english', coalesce(title,''))", persisted=True)`, `deferred=True`
- Indexes: `ix_community_topics_category_lists (category_id, is_pinned DESC, last_post_at DESC)`, `ix_community_topics_last_post_at (last_post_at DESC)` (Latest/Top), `ix_community_topics_author (author_id)` (profiles), GIN `ix_community_topics_title_tsv`

**`community_posts`**
- `topic_id` FK CASCADE, `author_id` FK users SET NULL nullable
- `post_number` Integer NOT NULL — OP = 1; assigned under topic `FOR UPDATE` lock: `n = topic.last_post_number + 1`
- `content` Text (raw markdown, cap 64,000 chars — backend never renders it), `edited_at` timestamptz nullable, `is_deleted` Boolean default false
- `like_count` Integer server_default "0"
- `content_tsv` TSVECTOR `Computed("to_tsvector('english', coalesce(content,''))", persisted=True)`, `deferred=True`
- Constraints/indexes: `uq_community_posts_topic_number (topic_id, post_number)` UNIQUE (doubles as the keyset-pagination index), `ix_community_posts_author (author_id)`, GIN `ix_community_posts_content_tsv`

**`community_post_likes`** — composite PK `(post_id, user_id)`, no surrogate id (exact `NoteTag` shape, tag.py:34-50); `created_at` timestamptz default now. FKs both CASCADE. Maintains `posts.like_count`: `pg_insert(...).on_conflict_do_nothing(constraint="pk_...")` → if rowcount==1, atomic `UPDATE community_posts SET like_count = like_count + 1`; unlike = delete → if rowcount==1, `- 1`. Idempotent under double-click.

**`community_topic_reads`** — composite PK `(user_id, topic_id)`; `last_read_post_number` Integer NOT NULL, `updated_at`. Upsert `on_conflict_do_update` with `GREATEST(existing, excluded)` so out-of-order beacons never move the pointer backward. Unread = `topic.last_post_number > last_read_post_number` — computable in the list query, no extra reads.

**`community_reports`** — UUIDMixin + timestamps; `post_id` FK CASCADE, `reporter_id` FK users SET NULL nullable, `reason` String(50), `detail` Text nullable, `status` String(16) server_default "open", `resolved_by_id` FK users SET NULL nullable, `resolved_at` nullable. `uq_community_reports_post_reporter (post_id, reporter_id)` UNIQUE. Index `ix_community_reports_status (status, created_at)`.

**Counter ownership summary**: `reply_count`, `last_post_number`, `last_post_at`, `last_post_author_id`, `category.topic_count/post_count` — community_service, transactionally, under the topic-row `FOR UPDATE` lock the post-number assignment already requires. `like_count` — like toggle, via ON CONFLICT + atomic bump. `view_count` — Celery beat flusher only. These are the codebase's first true incremental counters; every bump is `SET x = x ± 1` (never read-modify-write), matching the existing lock/upsert vocabulary (note_service.py:290-295, tag_service.py:36).

---

## 3. API Surface — `/api/v1/community` (`back/app/api/v1/community.py`)

Routers thin / services fat; `ServiceResponse.unwrap()`; `{"data": …}` / `{"error":{code,message}}` envelopes. Three auth deps: none (anon GETs, per the publish `public_router` precedent, publish.py:65), `CurrentUserId`, and two new deps in `app/dependencies/auth.py`: `get_optional_user_id → UUID | None` (same code as get_current_user_id, returns None instead of raising) and `require_staff` (loads the User row, 403 unless `is_staff` — mirrors `require_scopes`, app/api/public/deps.py:33, since `CurrentUserId` deliberately never touches the DB).

| Method | Path | Auth | Service call |
|---|---|---|---|
| GET | `/community/categories` | anon | `community_service.list_categories()` |
| GET | `/community/categories/{slug}/topics?limit&offset` | optional | `list_topics(category_slug, viewer_id)` — unread flags when authed |
| GET | `/community/topics/latest?limit&offset` | optional | `list_topics(sort="latest", viewer_id)` |
| GET | `/community/topics/top?period=week|month|all&limit&offset` | optional | `list_topics(sort="top", period, viewer_id)` |
| GET | `/community/topics/{topic_id}` | optional | `get_topic(topic_id, viewer_id)` — meta + viewer's last_read |
| GET | `/community/topics/{topic_id}/posts?after=0&limit=30` | optional | `list_posts(topic_id, after, viewer_id)` — keyset; includes viewer's liked-post ids |
| POST | `/community/topics` | user | `create_topic(user_id, category_id, title, content)` |
| POST | `/community/topics/{topic_id}/posts` | user | `create_post(user_id, topic_id, content)` |
| PATCH | `/community/posts/{post_id}` | user | `edit_post(user_id, post_id, content)` — own only unless staff |
| DELETE | `/community/posts/{post_id}` | user | `delete_post(user_id, post_id)` — soft; own or staff |
| DELETE | `/community/topics/{topic_id}` | user | `delete_topic(user_id, topic_id)` — own if reply_count==0, else staff |
| PUT | `/community/posts/{post_id}/like` | user | `like_post(user_id, post_id)` |
| DELETE | `/community/posts/{post_id}/like` | user | `unlike_post(user_id, post_id)` |
| PUT | `/community/topics/{topic_id}/read` | user | `mark_read(user_id, topic_id, last_read_post_number)` |
| POST | `/community/posts/{post_id}/report` | user | `moderation_service.report_post(user_id, post_id, reason, detail)` |
| GET | `/community/search?q&category&limit&offset` | anon | `community_service.search(q, category)` |
| GET | `/community/users/{user_id}` | anon | `public_profile(user_id)` — name, avatar, joined, counts, recent topics/replies |
| PATCH | `/community/topics/{topic_id}` | staff | `moderation_service.moderate_topic(...)` — is_pinned / is_locked / category_id / title |
| GET | `/community/reports?status&limit&offset` | staff | `moderation_service.list_reports(status)` |
| PATCH | `/community/reports/{report_id}` | staff | `moderation_service.resolve_report(staff_id, report_id, status)` |

Param validation uniform with search.py:22-24: `limit: Query(default=20|30, ge=1, le=100)`, `offset ge=0`. Write endpoints enforce: locked topic → 409 for non-staff replies/edits; `is_staff_only_posting` category → 403 for topic creation; body/title caps → 422; per-action rate limit → 429 in the standard envelope.

---

## 4. Frontend — `(marketing)/community/` (sibling of `(seo)`, which forbids client components)

```
(marketing)/community/
  layout.tsx                SiteNav + shell + SiteFooter (server, like docs/layout.tsx)
  page.tsx                  categories + latest topics — SSR, indexable
  c/[category]/page.tsx     topic list, ?page=N links — SSR, indexable
  t/[id]/[slug]/page.tsx    topic + posts, ?page=N — SSR, indexable; redirect() to canonical slug on mismatch
  new/page.tsx              composer — client body, pageMetadata({noindex:true})
  u/[id]/page.tsx           profile — SSR, noindex
  search/page.tsx           search — client island over anon endpoint, noindex
```

- **SSR**: all read pages are RSCs fetching through a new `web/src/lib/api/community-server.ts` cloned from `public-server.ts` (API_PROXY_URL direct-to-API, unwrap `{data}`, null-on-failure → friendly "not available" body, never 500). Difference: `next: { revalidate: 30 }` for lists instead of `no-store` — unpublish-privacy doesn't apply to a public forum, and 30s ISR absorbs read load.
- **Auth constraint**: the Next server can never see auth (access token is JS-memory-only; refresh cookie path-scoped to `/api/v1/auth`). Every auth-aware element is a client island subscribing to `useAuthStore((s) => s.status)` — the `redirect-authed.tsx` pattern. Islands: composer, reply box, like buttons, report dialog, staff controls, unread chips, read beacon, "Log in to reply" CTA swap. After mutations: `router.refresh()` re-renders the RSC — no TanStack mirror of server lists, no dual source of truth.
- **Chrome reuse**: `mk-card`, `mk-btn`, `mk-prose`, `.mk-docs-pager-link`-styled `?page=N` links (server-rendered — SEO surface; infinite scroll hides content from crawlers and has no repo precedent). Add `/community` to site-chrome.tsx nav row (:19-38) and `FOOTER_SITE`. One-time ~15-line CSS bridge remapping shadcn tokens under `[data-marketing]` so `Dialog`/`Tabs`/`Textarea` don't render workspace-grey on the mk skin.
- **Composer decision**: **textarea + Write|Preview tabs, NOT CodeMirror.** `MarkdownEditor` hard-requires `vaultId` (attachment upload, wikilink/tag autocomplete are vault-scoped; markdown-editor.tsx:60-77) and CM6 is a heavy bundle for the marketing surface. `ui/textarea` + `ui/tabs`; preview = client `<ReactMarkdown remarkPlugins={[remarkGfm]}>` in `mk-prose` — the identical pipeline the server uses, so preview matches the published post.
- **API client**: all endpoints in `endpoints.ts` as a `communityApi` group (hard rule). `api()` is anonymous-safe (attaches Authorization only if token set). Gate mutations on `status === "authenticated"` client-side so anonymous POSTs never 401 into the refresh/reset path.
- **SEO**: `pageMetadata()` canonicals + OG, `JsonLd` (`DiscussionForumPosting` for topics, breadcrumbs), `Breadcrumbs` from `components/seo/page-parts`, sitemap: register index + category pages in `app/sitemap.ts`; topics via a sub-sitemap `community/sitemap.xml/route.ts` following `s/[slug]/sitemap.xml` — the main sitemap shouldn't enumerate every thread.

---

## 5. Rendering / XSS Plan

Threat model: strangers' markdown shown platform-wide — strictly harsher than publish (which exposes an author only to their own visitors). The publish pattern transfers: **backend stores and serves raw markdown, never HTML** (vault_publish_service.py:94-101 precedent); Next renders it.

- New `web/src/components/community/post-body.tsx` — server-renderable ReactMarkdown, modeled on the docs page recipe (docs/[slug]/page.tsx:78-112), NOT `ReadingView` (vault-coupled: vaultId, onNavigate, vault embed resolution).
- **No `rehype-raw`, no DOMPurify** — the load-bearing guarantee. react-markdown without rehype-raw lowers raw HTML to literal text; arbitrary HTML is inert by construction (the repo doctrine: "allowlist by construction, not a sanitiser", inline-html.ts:10-14). v1 omits `remarkInlineHtml` entirely (option (b) — safest); posts get GFM only.
- Keep `defaultUrlTransform` untouched — kills `javascript:`/`data:` hrefs. Re-admit **no** custom schemes (no `nodum:` — wikilinks disabled in forum posts; targets are vault-private).
- External links: `target="_blank" rel="noreferrer noopener"` via the `a` override.
- `img` override: render as a plain link, never an `<img>` — blocks tracking pixels / IP leaks (reading-view passes remote src through at :146, acceptable for private notes, not for a public forum).
- `pre` override: `ShikiCodeBlock` yes (shiki HTML-escapes content itself; the `dangerouslySetInnerHTML` sink is output-encoded by construction); **mermaid branch disabled** (one-line branch: stranger diagrams + 1.5MB bundle + historical CVEs).
- No `%%comment%%` stripping (would silently eat "100%% sure…"), no math/KaTeX v1.
- Search snippets: reuse the `sanitizeSnippet` idiom (search-pane.tsx:175-181) — escape everything, re-admit only literal `<mark>` from `ts_headline`.
- Backend: 64KB content cap; any backend text processing (future mention extraction) must be linear-time — the markdown_parse.py:37-54 ReDoS incident is the standing rule; no HTML generation server-side, ever.

---

## 6. Efficiency Plan

- **Topic-list pagination**: limit/offset + window-function count in one query — `stmt.add_columns(func.count().over().label("total_count"))`, tie-broken ordering `(is_pinned DESC, last_post_at DESC, id DESC)` so pages never repeat/skip, honest-total fallback when offset lands past the end (clone note_service.py:215-252 exactly). Backed by `ix_community_topics_category_lists`.
- **Thread pagination**: keyset on `post_number` — `WHERE topic_id=:t AND post_number > :after ORDER BY post_number LIMIT 30`, served by the `(topic_id, post_number)` unique index. Stable deep pages under concurrent deletes, free "jump to post #N", and `total` is `last_post_number` off the topic row — no count query at all.
- **No N+1**: lists join authors in the SELECT (single query); the posts page fetches viewer like-state with one `WHERE post_id IN (:page_ids) AND user_id=:viewer` query; unread flags come from a single `LEFT JOIN community_topic_reads ON (topic_id, user_id=:viewer)` folded into the list query — zero extra round trips for anonymous viewers.
- **Counters**: reply/last_post/category counts bumped atomically inside the same transaction as the write, under the topic `FOR UPDATE` lock already needed for post_number (note_service.py:295 discipline). Likes via `on_conflict_do_nothing` + conditional bump. Never read-modify-write.
- **Views**: `HINCRBY community:views:pending {topic_id} 1` on **`redis_control`** (DB 3 — never evicted; an allkeys-lru eviction on the cache DB would silently eat views), fail-open like all Redis here. Celery beat task every 60s: rename-then-read (`RENAME` to a scratch key, `HGETALL`, `DEL`) → bulk `UPDATE community_topics SET view_count = view_count + :v` — new module in `app/tasks/`, `asyncio.run` + `async_session_factory` idiom from tasks/maintenance.py:18-41, added to `include=` and `beat_schedule`. Dedupe with `SET NX EX 600` on `community:viewed:{user_or_ip}:{topic}`.
- **Unread**: `community_topic_reads` upsert with `GREATEST`; badge = `last_post_number > last_read_post_number` computed in-list; client beacon fires debounced from the thread page. 300/min global limiter absorbs it.
- **Caching**: category list through `cache_get_json/cache_set_json` (`cache_utils.py`), key `community:categories:v1`, TTL 300 (`CACHE_TREE_TTL` precedent), `cache_delete` on every category-touching write — the manual-invalidation duty is the house convention. Topic lists NOT Redis-cached v1 (unread personalization + 30s Next ISR already shields the DB). Cache blobs on `redis_client` (DB 0).
- **FTS**: `Computed(..., persisted=True)` tsvectors + GIN (0004 migration template) — generated columns beat triggers: zero drift, no maintenance. Query: `websearch_to_tsquery('english', q)` + `.op("@@")`, `ts_rank_cd` ranking, `ts_headline` with `StartSel=<mark>` (search_service.py:126-147). Topics (title) and posts (body) searched separately and merged — no multi-table tsvector.
- **Rate limits**: per-action, in the service layer (domain rule, not transport) — small helper on `redis_control` with the middleware's INCR+EXPIRE fail-open idiom: `rl:community:topic:{user_id}` 5/hr, `rl:community:post:{user_id}` 30/hr + `SET NX EX 30` min-gap key. The global two-bucket middleware is untouched.
- **Deploy**: zero Caddy/compose changes — `/community` rides web:3000, `/api/v1/community` rides api:8000; migration 0021 applies via the existing `migrate` service; the flusher rides the existing celery-worker `-B`.

---

## 7. Sprint / Task List (→ `tasks/nodum-community-plan.md` verbatim)

# Nodum Community — Sprint Plan

Branch chain off `dev`, each branch cut from the tip of the previous, merged to `dev` with `--no-ff` when green. Branch names follow `<kind>/<N>.<slug>_maqbool_<DDMMYYYYHHMM>` (timestamp assigned at cut time). Gate for every task: `make verify` green + the task's listed tests green (`make back-test-int` needs dev infra up via `./deploy/compose.sh dev up -d postgres redis minio`).

### S1.1 — `feature/1.community-models`
**Delivers**: `back/app/models/community/` package (categories, topics, posts, post_likes, topic_reads, reports per the data model), `users.is_staff`, migration `back/alembic/versions/0021_community.py` (revision "0021", down_revision "0020") including tsvector Computed columns + GIN indexes and the 5 seeded categories; `slugify()` util (linear-time) in `back/app/utils/`; `COMMUNITY_BOOTSTRAP_STAFF_EMAIL` + `COMMUNITY_POST_MAX_CHARS` settings; startup hook flipping the bootstrap staff column.
**Acceptance**: `alembic upgrade head` and `downgrade -1` both clean on a fresh DB; categories seeded exactly once; `is_staff` appears in `UserOut` via `/auth/me`; no service/router code yet.
**Tests**: unit — slugify edge cases (empty, unicode, 300-char titles), model constraint names; integration — migration round-trip against dev postgres, `/auth/me` carries `is_staff:false`. No e2e.

### S1.2 — `feature/2.community-read-api`
**Delivers**: `community_service.py` read paths + `api/v1/community.py` anon GETs (categories, category topics, latest, top, topic meta, keyset posts, public profile), registered in `api/v1/router.py`; `get_optional_user_id` dep; offset+window-count list pagination with tie-break and honest-total fallback; keyset thread pagination; single-query author joins; category-list Redis cache (`community:categories:v1`).
**Acceptance**: all GETs return `{"data": …}` with `total/limit/offset` on lists and no auth header required; keyset `after` never repeats/skips across a concurrent insert; deleted posts appear as placeholder rows (`is_deleted:true`, no content); unknown ids → 404 envelope.
**Tests**: integration `tests/integration/test_community.py` started (test_vault_publish.py shape, `_signup` helper with `@nodumtest.dev` emails): anonymous list/read paths, pagination math (total honesty past-the-end), keyset stability, 404s. No e2e.

### S1.3 — `feature/3.community-write-api`
**Delivers**: create topic / create post under `CurrentUserId` with topic `FOR UPDATE` lock, `post_number = last_post_number + 1`, transactional counter bumps (reply_count, last_post_*, category counts); edit/delete own post (soft), delete own replyless topic; locked-topic and staff-only-category enforcement; content caps; per-action rate-limit helper (`rl:community:topic:*` 5/hr, `rl:community:post:*` 30/hr + 30s gap, fail-open, disabled in dev/test like the middleware).
**Acceptance**: two concurrent replies get distinct post_numbers; reply bumps reply_count/last_post_at atomically; soft-deleted reply decrements reply_count but never last_post_number; non-author edit → 403; locked topic reply → 409; over-cap body → 422; rate-limit breach → 429 standard envelope with Retry-After.
**Tests**: integration — happy-path create/edit/delete, two-user permission matrix (author/other), lock/staff-only/cap/rate-limit rejections, counter assertions after each mutation, concurrent-reply post_number race (asyncio.gather).

### S1.4 — `feature/4.community-likes-reads`
**Delivers**: like/unlike (`on_conflict_do_nothing` + conditional atomic bump), `mark_read` upsert with `GREATEST`, unread flags folded into topic-list queries for authenticated viewers (LEFT JOIN), viewer liked-post ids on the posts page (single IN query).
**Acceptance**: double-like is idempotent (like_count moves once); unlike of never-liked is a no-op 200; read pointer never moves backward; list responses carry `unread` only when authed; anonymous lists identical to before (no extra queries).
**Tests**: integration — like idempotency under repeated calls, count integrity after like/unlike cycles, GREATEST behavior with out-of-order beacons, unread flag correctness across two users, self-like allowed-or-not decision pinned.

### S1.5 — `feature/5.community-moderation`
**Delivers**: `require_staff` dep (loads User row, mirrors `require_scopes`); staff PATCH topic (pin/lock/recategorize/retitle — category counters move on recategorize); staff delete any post/topic; `community_moderation_service.py` with report_post (unique per reporter+post), list/resolve reports.
**Acceptance**: non-staff → 403 on every staff route; pin reorders category list (pinned first); duplicate report → 409; resolving stamps resolved_by/resolved_at; staff soft-delete leaves placeholder and fixes counters.
**Tests**: integration — three-user matrix (staff/author/other) over every moderation route, report lifecycle open→resolved, pinned-ordering assertion, category-count migration on recategorize.

### S1.6 — `feature/6.community-search-views`
**Delivers**: `GET /community/search` (websearch_to_tsquery over topics.title_tsv + posts.content_tsv, merged, ts_rank_cd, ts_headline `<mark>` snippets, category filter, window-count pagination); view counting (HINCRBY on redis_control + SETNX dedupe) and Celery beat flusher task (60s, rename-then-read, bulk UPDATE) wired into celery.py `include`/`beat_schedule`.
**Acceptance**: search finds title and body matches with snippets, excludes soft-deleted content, empty q → 422; viewing a topic twice within dedupe window counts once; flusher drains the hash to view_count and survives Redis being down (fail-open, no 500s).
**Tests**: integration — search relevance/exclusion/pagination, snippet contains only `<mark>` markup; flusher invoked directly (call the task's async body) asserting bulk update + hash cleared; view endpoint increments pending hash.

### S2.1 — `feature/7.community-web-read`
**Delivers**: `web/src/lib/api/community-server.ts` (public-server.ts clone, revalidate 30, null-on-failure); `(marketing)/community/` layout + index + `c/[category]` + `t/[id]/[slug]` RSC pages with `?page=N` pager links (mk-docs-pager-link style); canonical-slug redirect; `components/community/post-body.tsx` (GFM-only ReactMarkdown, no rehype-raw, img-as-link, shiki-only pre, external-link rel attrs) in `mk-prose`; SiteNav/FOOTER_SITE entries; `pageMetadata` + JSON-LD + Breadcrumbs; sitemap entries + `community/sitemap.xml` topic sub-sitemap.
**Acceptance**: anonymous browse of index → category → thread works with zero JS required for content; thread markdown (code fences, blockquotes, raw `<script>` shown as literal text) renders correctly; wrong slug 308s to canonical; pages carry title/canonical/JSON-LD in initial HTML.
**Tests**: backend — none new; e2e `web/e2e/community.spec.ts` (vault-site.spec.ts shape): seed topic via in-page authed fetch → `clearCookies()` → anonymous browse assertions → crawler view via `page.request.get()` (content in raw HTML, `<title>`, canonical, no noindex, JSON-LD parse, sitemap includes index) → literal `<script>` text visible, not executed.

### S2.2 — `feature/8.community-web-compose`
**Delivers**: `communityApi` group in `endpoints.ts`/`types.ts`; shadcn-token CSS bridge under `[data-marketing]`; `/community/new` composer (textarea + Write|Preview tabs, client ReactMarkdown preview, category select, noindex); reply island on thread page; edit/delete-own controls with confirm Dialog; auth-gated CTAs via `useAuthStore` status islands ("Log in to reply" ↔ composer); `router.refresh()` after every mutation.
**Acceptance**: signed-in user creates a topic and replies through the UI and sees them after refresh-less navigation; preview matches rendered post byte-for-byte for GFM constructs; anonymous visitor sees CTAs, never fires an authed request; own-post edit shows `edited` marker; locked topic hides the reply box.
**Tests**: e2e — `signupFreshUser` → create topic via composer → reply → edit → delete → placeholder visible; second user cannot see edit/delete controls on first user's post; anonymous thread shows login CTA.

### S2.3 — `feature/9.community-web-engage`
**Delivers**: like button islands with optimistic count + refresh; unread chips on topic lists (authed island reading list payload); read beacon (debounced `PUT /read` from thread page) + resume-at-unread anchor; `u/[id]` profile page (SSR, noindex); `/community/search` page (client island, `sanitizeSnippet`-style mark re-admission).
**Acceptance**: like toggles persist across reload; a reply by user B makes the topic show an unread chip for user A, cleared after A opens it at the right post; profile lists the user's topics/replies with stats; search page renders results with highlighted snippets and category filter.
**Tests**: e2e — like/unlike round trip; two-user unread flow (B replies → A sees chip → A opens → chip gone); profile page contents; search finds the seeded topic. Backend — none new.

### S2.4 — `feature/10.community-web-staff`
**Delivers**: report dialog on posts (reason + detail); staff-only islands gated on `is_staff` from `/auth/me`: pin/lock/delete controls on topics/posts, `/community/mod/reports` queue page (client, noindex) with resolve/dismiss; a documented SQL/env note for staff bootstrap in the plan doc.
**Acceptance**: user reports a post once (second attempt surfaces friendly error); staff sees queue, resolves, sees pin/lock reflected in public lists; non-staff never sees moderation UI or the queue route content.
**Tests**: e2e — report flow as user; staff flow requires flipping `is_staff` — do it via the bootstrap env on the e2e backend or a dedicated test-only path consistent with "never poke flags into the DB" by using the env bootstrap at server start; assert pin ordering and lock hiding the reply box; non-staff blocked. Backend — none new.

### S2.5 — `chore/11.community-docs-ship`
**Delivers**: `web/src/content/docs/community.md` (frontmatter: title/section/order/summary/where; screenshots in `web/public/docs/`); `deploy/smoke.sh` line (anonymous GET `/community` expects 200 + content marker); `seo.spec.ts` additions for community pages; master-plan checkbox + Progress Log entry with gate counts; final chain merge to `dev` `--no-ff`.
**Acceptance**: docs article appears in `/docs` index, rail search, and sitemap; docs.spec image-200 check passes; `make verify`, `make back-test-int`, full `make e2e`, and `deploy/smoke.sh` against the local prod stack all green.
**Tests**: existing docs.spec/seo.spec extended; full-suite run is the deliverable.

---

## 8. Appendix — exact reusables for the implementer

**Backend paths/patterns to copy**
- Models: `back/app/models/base.py` — `UUIDMixin` (uuid7), `TimestampMixin`; association-table shape `back/app/models/vaults/tag.py:34-50` (`NoteTag`, composite PK, no surrogate)
- Computed tsvector + deferred + GIN: `back/app/models/vaults/note.py:48-64`; migration template `back/alembic/versions/0004_search_and_tags.py`; next revision `0021`, down_revision `"0020"` (chain tip: `0020_api_token_scopes.py:14-15`)
- FTS query kit: `back/app/services/search_service.py:126-147` — `websearch_to_tsquery`, `.op("@@")`, `ts_rank_cd`, `ts_headline("english", col, tsquery, "StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, MaxFragments=2")`
- List pagination (copy verbatim): `back/app/services/note_service.py:215-252` — `func.count().over().label("total_count")`, id tie-break, past-the-end honest total; router params `back/app/api/v1/search.py:22-24`
- Row lock: `note_service.py:274-309` (`with_for_update()`); upsert idioms: `back/app/services/tag_service.py:33-36` (`pg_insert(...).on_conflict_do_nothing(constraint=...)`)
- Auth deps: `back/app/dependencies/auth.py` — `get_current_user_id` (:44-49), `CurrentUserId` (:52); staff-dep model `back/app/api/public/deps.py:33-65` (`require_scopes`); anon-router precedent `back/app/api/v1/publish.py:65-124` + mount `back/app/api/v1/router.py:44`
- Redis: `back/app/utils/cache_utils.py` (`cache_get_json`/`cache_set_json`/`cache_delete`, fail-open); `back/app/core/redis.py` — `redis_client` DB 0 cache, **`redis_control` DB 3 for views/rate counters**
- Celery: `back/app/core/celery.py:26-31` (beat_schedule), async-in-task idiom `back/app/tasks/maintenance.py:18-41` (`asyncio.run` + `async_session_factory`)
- Rate-limit idiom: `back/app/core/middlewares/rate_limit_middleware.py` (INCR+EXPIRE, fail-open, dev/test-disabled, 429 envelope + Retry-After); settings `back/app/settings/common.py:156-159`
- Linear-time markdown utilities + ReDoS doctrine: `back/app/utils/markdown_parse.py:37-54, 72-127`

**Frontend paths/patterns to copy**
- Server fetcher template: `web/src/lib/api/public-server.ts` (:20 API_PROXY_URL, :52-69 null-on-non-200, envelope unwrap) → clone as `community-server.ts` with `revalidate: 30`
- SSR markdown recipe: `web/src/app/(marketing)/docs/[slug]/page.tsx:78-112` (ReactMarkdown + remarkGfm in `mk-prose`, custom `p`/`a`); NOT `web/src/components/editor/reading-view.tsx` (vault-coupled)
- URL safety: react-markdown `defaultUrlTransform` (keep; re-admit nothing); external-link attrs pattern reading-view.tsx:114; shiki block `web/src/components/editor/code-block.tsx` (safe sink)
- Snippet sanitizer: `web/src/components/workspace/search-pane.tsx:175-181` (`sanitizeSnippet` — escape all, re-admit literal `<mark>`)
- Auth island: `web/src/components/marketing/redirect-authed.tsx` (:19-26) + `web/src/lib/stores/auth-store.ts` bootstrap (:36-45); token constraint `web/src/lib/api/client.ts:1-9, :49, :117-144`
- Chrome: `web/src/components/marketing/site-chrome.tsx` (nav row :19-38, CTAs :40-47, footer arrays :54-79); skin `web/src/app/(marketing)/marketing.css` (`.mk-card` :134, `.mk-btn` :149-215, `.mk-prose` :642-732); shadcn-token caveat `globals.css:95,101`
- SEO kit: `web/src/lib/seo/metadata.ts` (`pageMetadata`), `web/src/lib/seo/jsonld.ts` + `JsonLd`, `components/seo/page-parts` (`Breadcrumbs`), `web/src/app/sitemap.ts` + sub-sitemap `s/[slug]/sitemap.xml/route.ts`
- Docs article shape: `web/src/lib/docs.ts:44-73` (`DOC_SECTIONS`, frontmatter keys); example `web/src/content/docs/publish.md:1-6`

**Test fixtures/helpers**
- Backend client fixture: `back/tests/conftest.py:63-67` (httpx ASGITransport); session-scoped loops `back/pyproject.toml:110-111` — never change; `EMAIL_VERIFICATION_REQUIRED=false` at conftest.py:14
- `_signup` helper shape: `back/tests/integration/test_public_api.py:16-24` — `@nodumtest.dev` emails, `client.cookies.clear()` after signup, returns Bearer header dict; workspace-fixture variant `test_vault_publish.py:9-23`; anonymous-read style `test_vault_publish.py:44`
- e2e helpers: `web/e2e/helpers.ts` — `uniqueEmail` (:3), `signupFreshUser` (:60-90), DEV_OTP "123456" (:10), in-page authed fetch seeding pattern `createNoteViaApi` (:114-169); config `web/playwright.config.ts` (workers:1, BASE_URL :3100)
- Public-page e2e template: `web/e2e/vault-site.spec.ts` (seed → publish → `page.context().clearCookies()` :30 → anonymous assertions → crawler raw-HTML checks :49-77); anon docs template `web/e2e/docs.spec.ts`; JSON-LD/robots `web/e2e/seo.spec.ts`
- Deploy gate: `deploy/smoke.sh <base-url>`; no Caddy/compose changes needed (`deploy/caddy/Caddyfile` already routes `/api/*` and everything-else)