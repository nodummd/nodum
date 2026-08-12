# Nodum — Deep Audit & Roadmap (v1 → v2)

> Produced 2026-08-12 from a full-depth pass: 13-test Playwright e2e suite,
> 35 backend integration tests, and a 5-dimension adversarial audit workflow
> (backend correctness, security, frontend correctness, Obsidian parity,
> scale/performance). **This is the decision document** — each section ends
> with a priority so we can pick the next phase together.

---

## 1. Where we are (verified working)

| Area | State | Verified by |
|------|-------|-------------|
| Auth (signup/login/refresh-rotation+grace/logout/profile) | ✅ | 8 API tests + 6 e2e |
| Vaults / folders / notes CRUD, materialized paths, tree | ✅ | 9 API tests + e2e |
| Wikilink extraction, backlinks, unlinked mentions, ghost links | ✅ | 15 API tests + e2e |
| FTS search w/ operators, quick switcher, tags | ✅ | 6 API tests + e2e |
| Attachments (MinIO, presigned, `![[embed]]` resolution) | ✅ | e2e-style API test |
| Obsidian-faithful workspace UI (ribbon/explorer/tabs/panels/status bar) | ✅ | Browser + e2e |
| CM6 Live Preview (reveal-on-cursor, checkboxes, wikilink pills, autocomplete) | ✅ | Browser + 4 e2e |
| Reading view (KaTeX, GFM, wikilink nav) · Source mode | ✅ | e2e |
| GPU graph (cosmos.gl, labels, filters, forces, ghost-click-creates) | ✅ | Browser + 2 e2e |
| Docker dev stack (postgres+redis+minio, loopback ports) | ✅ | daily use |
| CI (backend lint+test, web lint+build, gitleaks) | ✅ | GitHub Actions |

**Test totals: 35 backend + 13 Playwright e2e — all green.**

Fixed during this audit session:
- Refresh-token rotation race: 30s Redis grace window for the just-spent JTI
  (racing tabs no longer kill the session family; true reuse still does).
- Reading view: `[[wikilinks]]` inside code spans stay literal.
- Next dev overlay intercepted ribbon clicks (disabled `devIndicators`).

## 2. Audit findings (30-agent workflow, adversarially verified)

**80 raw findings → 23 confirmed defects (+2 refuted, 55 parity/minor).**
Full detail: workflow `wf_cfded3bb-7d0` output (session artifacts).

### ✅ Fixed in this audit session (10)
| Sev | Finding | Fix |
|-----|---------|-----|
| P1 | **LIKE-wildcard subtree corruption** — folder names with `%`/`_` corrupt unrelated sibling folders on rename/move | `startswith(..., autoescape=True)` |
| P1 | Optimistic-concurrency save was check-then-write (concurrent saves silently lost) | `FOR UPDATE` row lock |
| P1 | Placeholder JWT/SECRET keys boot fine in production (auth bypass if deployed as-is) | ProductionSettings fail-fast validator |
| P1 | Editor 409 → silent infinite save-failure loop (data loss) | adopt server timestamp + bounded resubmit |
| P1 | Refresh-token reuse defense killed all sessions on benign concurrent refresh | 30s Redis grace window + `FOR UPDATE` on rotation |
| P1 | Rate limiter keyed on proxy socket IP (one global bucket behind reverse proxy) | `TRUST_PROXY_HEADERS` → first X-Forwarded-For hop |
| P2 | Folder rename/move/delete never invalidated the Redis graph cache | `cache_delete(vault_graph_key)` on all three |
| P2 | Concurrent saves introducing the same new tag → unique-violation 500 | `ON CONFLICT DO NOTHING` + re-read |
| P2 | 4 workers × pool(20+10) = 120 conns > Postgres max 100 | pool 10+5 (60 total) |
| P2 | Save-flush missing on unmount (≤700ms typing lost) + stale tabs stuck on Loading | flush-on-unmount + tab pruning on 404 |
| P2 | Reading view rewrote `[[links]]` inside code spans | code-segment-aware preprocessing |

### ⏳ Confirmed, queued (next fixes — Phase A)
| Sev | Finding | Notes |
|-----|---------|-------|
| P2 | Path-based wikilinks don't re-resolve after folder rename/move | needs link retarget pass in `_recompute_subtree_paths` |
| P2 | Explorer mutations fail silently (duplicate name, delete errors) | needs toast/error surfacing |
| P2 | Graph re-created per force-slider tick (WebGL teardown thrash) | debounce sliders / `setConfig` instead of rebuild |
| P2 | Expired session mid-use: no logout transition; 401 refresh-storm | auth store should react to hard 401s |
| P2 | Wikilink nav fires on any mouse button (hijacks right-click/drag) | check `event.button === 0` |
| P2 | `search_notes.total` = page size (breaks pagination UI) | window count or `count(*) OVER ()` |
| P2 | Attachment upload buffers whole body in RAM before size check | stream + reject at limit |
| P3 | Access tokens valid ≤15min after logout/password change | jti denylist in Redis if needed |
| P3 | Sessions table unbounded; signup spans 3 commits; S3/DB ordering | Celery pruning task; single transaction; upload-then-record |

### Scale ceilings (fine now, must fix before big vaults — Phase B)
- Tree/graph/backlinks endpoints are unbounded (~15-20MB JSON at 100k notes)
- Unlinked-mentions ILIKE seq-scan fired on every note open
- No functional index for `lower(title)` link resolution (per-save vault scan)
- Explorer renders all rows + a Radix ContextMenu each (needs virtualization)
- Quick-switcher fires per keystroke unindexed + no debounce
- Redis 256MB `allkeys-lru` shared by cache blobs and rate-limit counters
- react-query retains full 2MB note bodies for 5min per note visited

## 3. Obsidian parity gaps (what an Obsidian user notices, in order)

| # | Gap | Notices in… | Size | Priority |
|---|-----|-------------|------|----------|
| 1 | **Command palette contents** (⌘P: new note, toggle mode, open graph, daily note, rename, delete…) | minutes | S | **P0** |
| 2 | **Callout rendering** — 13 types w/ icons/colors/foldability (live preview + reading) | minutes | M | **P0** |
| 3 | **Daily notes** (ribbon button, date-format setting, template) | hours | S–M | **P0** |
| 4 | **Embeds render inline** — `![[Note]]` transclusion, `![[img.png]]` images from attachments | hours | M | P1 |
| 5 | **Properties UI** — frontmatter as editable widget in live preview | hours | M–L | P1 |
| 6 | **Math/mermaid in live preview** (currently reading-view only) | hours | M | P1 |
| 7 | **Templates** (folder + insert command + `{{date}}` vars) | days | S–M | P1 |
| 8 | **Local graph in right panel** (component props exist, not surfaced) | days | S | P1 |
| 9 | **Tables render in live preview** | days | M | P2 |
| 10 | **Bookmarks pane** | days | S | P2 |
| 11 | **Aliases** (frontmatter `aliases:` in switcher + link resolution) | days | M | P2 |
| 12 | **Graph groups** (color by query) + graph settings persistence | days | M | P2 |
| 13 | **Hotkey coverage** (Cmd+B/I/K formatting, Cmd+E mode cycle, Cmd+W close tab…) | days | S | P2 |
| 14 | **Settings modal** (account, editor prefs, daily-note config, hotkey list) | days | M | P2 |
| 15 | **Import/export** — Obsidian vault zip in, zip out (**the adoption feature**) | first session for a switcher | M | **P0** |
| 16 | Block references `[[Note^block]]` render/anchor | weeks | L | P3 |
| 17 | Canvas | weeks | XL | P3 |
| 18 | Sync/mobile apps | — | XL | P3 (out of v1 scope) |

## 4. Production readiness (before real users)

| Item | Why | Size |
|------|-----|------|
| **Prod compose full-boot verification** (api+web+worker images build & serve) | DoD item, never run end-to-end | S |
| **CI e2e job** (compose test env + Playwright headless) | stop regressions at PR time | M |
| Session table pruning (Celery beat: delete expired/invalidated) | unbounded growth | S |
| Note version history (snapshots on save, prune to 50) | data-loss insurance — table exists in plan, not built | M |
| Tree/graph payload limits + explorer virtualization | 10k-note vaults | M |
| Error reporting wiring (Sentry DSN plumbed but unused in web) | ops blindness | S |
| Reverse-proxy reference config (Caddy) + deploy docs for nodum.md | anyone can self-host | S |
| Backup/restore documentation (pg_dump + MinIO mirror) | open-source credibility | S |

## 5. Beyond Obsidian (differentiators — the "better than" list)

1. **Instant multi-device** — it's a web app; Obsidian charges for Sync. Zero work, message it.
2. **Publish** — one-click public read-only note/vault pages (server-rendered reading view). _M, high wow._
3. **Real-time collaboration** — CRDT (Yjs + y-codemirror.next, scoped in research). Obsidian fundamentally can't. _XL, v2 flagship._
4. **Semantic search / related-notes** — pgvector already in the image; embed notes, "similar notes" panel. _M–L._
5. **API-first** — the REST API is already clean + documented (OpenAPI); publish it as a feature. _S._
6. **Web clipper / share-target PWA** — capture to vault from any device. _M._
7. **Graph time-travel** — replay vault growth (created_at is already there). _S, demo-candy._

## 6. Proposed plan (my recommendation)

**Phase A — "finish v1.0"** (ship-ready open-source release)
1. Fix remaining audit defects (graph-cache invalidation, save-flush, stale tabs)
2. Command palette with real commands (parity #1)
3. Callouts full rendering (parity #2)
4. Daily notes + templates (parity #3+#7)
5. Obsidian vault import/export (parity #15)
6. Prod compose verification + CI e2e + session pruning
7. README/docs polish + `.claude/skills/nodum-*` project skills

**Phase B — "v1.1 polish"**: embeds inline, properties UI, live-preview math,
local graph panel, settings modal, hotkeys, bookmarks, virtualization.

**Phase C — "v2.0 differentiators"**: publish → semantic search → collaboration.

## 7. References
- Audit workflow output: session workflow `nodum-deep-audit` (wf_cfded3bb-7d0)
- Parity specs: `docs/research/obsidian-core-spec.md`, `obsidian-graph-spec.md`
- Library decisions: `docs/research/DECISIONS.md`
- Progress history: `tasks/nodum-master-plan.md` §6
