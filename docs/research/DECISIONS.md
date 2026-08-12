# Nodum — Research Decisions (Final)

Synthesized 2026-08-12 from `docs/research/{editor-stack,graph-stack,web-stack,obsidian-core-spec,obsidian-graph-spec,hourly-conventions}.md`. This document is decisive: where research offered options, a choice is made here. Versions were verified against npm on 2026-08-12.

---

## 1. Final frontend package list

### 1.1 Editor (CodeMirror 6)

| Package | Version |
|---|---|
| `@codemirror/state` | ^6.7.1 |
| `@codemirror/view` | ^6.43.8 |
| `@codemirror/language` | ^6.12.4 |
| `@codemirror/commands` | ^6.10.4 |
| `@codemirror/autocomplete` | ^6.20.3 |
| `@codemirror/search` | ^6.7.1 |
| `@codemirror/lang-markdown` | ^6.5.2 |
| `@lezer/markdown` | ^1.7.2 |
| `@lezer/highlight` | ^1.2.3 |

**Decisions:**
- Mount `EditorView` manually in a React ref (full control); do **not** use `@uiw/react-codemirror`.
- Live Preview decorations are **written in-repo** (~600 LOC), vendoring patterns from SilverBullet `client/codemirror/` (MIT) and ixora (Apache-2.0). Do **not** depend on `@retronav/ixora` or any small live-preview package.
- Wikilinks/hashtags become first-class Lezer nodes via `MarkdownConfig` `parseInline` extensions (SilverBullet `parser.ts` pattern).
- Block-level replace decorations (tables, math, code fences, embeds) go through a **StateField** (not ViewPlugin), with the two `isUserEvent` guards (`input.type.compose`, `select.pointer`) and `EditorView.atomicRanges` over replaced blocks.
- Deferred (post-v1, already scoped): `@replit/codemirror-vim` 6.4.0, `y-codemirror.next` 0.3.5.

### 1.2 Reading view (unified/remark/rehype)

| Package | Version |
|---|---|
| `react-markdown` | ^10.1.0 |
| `remark-gfm` | ^4.0.1 |
| `remark-math` | ^6.0.0 |
| `remark-frontmatter` | ^5.0.0 |
| `@portaljs/remark-wiki-link` | ^1.2.0 |
| `rehype-katex` | ^7.0.1 |
| `katex` | ^0.18.4 |
| `rehype-callouts` | ^2.2.0 |
| `rehype-slug` | ^6.0.0 |
| `mermaid` | ^11.16.1 |
| `@shikijs/rehype` / `shiki` | ^4.4.3 |

**Decisions:**
- Wikilinks: `@portaljs/remark-wiki-link` (Obsidian shortest-path resolution, `[[page#header|alias]]`, embeds) — not `remark-wiki-link`.
- Callouts: `rehype-callouts` (ships an Obsidian theme). `remark-obsidian-callout` is officially unmaintained — never use it.
- Mermaid renders **client-side** via `mermaid.render()` in a React component. `rehype-mermaid` is Playwright-based (build/SSR only) — never put it in the browser bundle.
- The same KaTeX/mermaid render components + caches serve both the CM6 block widgets (Live Preview) and Reading view.

### 1.3 Graph

| Package | Version |
|---|---|
| `@cosmos.gl/graph` | 3.4.0 |

**Decision: cosmos.gl wins.** GPU-shader force simulation + GPU rendering (WebGL2, luma.gl); the only option keeping the live, springy, draggable Obsidian feel at 60fps past 10k nodes (proven to 100k–1M). MIT under the OpenJS Foundation. Wrap in a ~40-line `'use client'` component loaded via `next/dynamic({ ssr: false })`. Built-in drag, reheat control, and hover-neighbor highlight APIs.

- **Hard license rule:** never install `@cosmograph/cosmos` or `@cosmograph/react` — both relicensed CC-BY-NC-4.0 (non-commercial).
- Node labels are the one gap: build an HTML overlay for top-N visible nodes (by degree/zoom), positioned via cosmos.gl's tracked-position APIs.
- Contingency (not a dependency today): `react-force-graph-2d` 1.29.1 gives identical d3-force feel under ~3–5k nodes in an afternoon if cosmos.gl integration blocks a milestone.

### 1.4 UI / app shell

| Package | Version |
|---|---|
| `next` | 15.5.23 (see §3 delta — plan Next 16 upgrade) |
| `react` / `react-dom` | 19.2.8 |
| `typescript` | ~5.9 (stay on 5.x; Next 15.5 rejects TS ≥ 7) |
| `tailwindcss` + `@tailwindcss/postcss` | 4.3.3 (both, matched) |
| `shadcn` CLI | 4.13.1 (`npx shadcn@latest`) |
| `zustand` | 5.0.14 |
| `@tanstack/react-query` (+ devtools) | 5.101.4 |
| `cmdk` | 1.1.1 (via shadcn `add command`) |
| Node runtime | node:22-alpine |

**Decisions:** Tailwind v4 CSS-first config (no `tailwind.config.js`); shadcn generates React-19-style components (no `forwardRef`, `data-slot`). Zustand for client/UI state only; react-query for all server state (v5 API: object signatures, `isPending`, `gcTime`). Command palette = shadcn `Command` (cmdk) in a Dialog, open-state in a zustand store. Auth = Pattern A: FastAPI is the only auth authority; httpOnly refresh cookie scoped to the refresh path, short-lived access token in memory; reverse-proxy `/api/*` to FastAPI so cookies are first-party and CORS disappears.

---

## 2. The 10 Obsidian behaviors we must nail

1. **Live Preview reveal-on-cursor.** Document is always plain markdown; syntax marks hide and formatting renders in place **except** where the cursor/selection touches the enclosing element — then raw syntax reappears for exactly that range. Heading `#`s hide off-line; `**` hides outside bold; wikilink brackets/target reappear on entry. Heading sizes come from `Decoration.line` CSS classes so line height never jumps. Plus Source mode (everything raw) and Reading view (`Cmd/Ctrl+E`) as separate modes.

2. **Wikilink semantics and resolution.** All forms: `[[Note]]`, `[[path/Note]]`, `[[Note|alias]]`, `[[#Heading]]`, `[[Note#Heading]]`, `[[Note#H1#H2]]`, `[[Note#^block-id]]`, `![[...]]` embeds, markdown-link equivalence. Resolution: shortest-path-when-unique, **case-insensitive**, matches **aliases** from frontmatter; links auto-update on rename/move. Unresolved links render dimmed, appear as ghost nodes in the graph, and **clicking one creates the note** and opens it.

3. **Embeds/transclusion.** `![[Note]]` renders the whole note in place; `![[Note#Heading]]` only that section; `![[Note#^block]]` just that block. Images `![[img.png|640x480]]` / `|100` width-only; PDFs `![[Doc.pdf#page=3]]`; audio players. Render inline in both Live Preview (block widget) and Reading view.

4. **Callouts, complete.** `> [!type]` with case-insensitive type, optional inline-markdown title, title-only form, foldable `-`/`+` with chevron, arbitrary nesting, unknown types falling back to `note` styling but keeping `data-callout`. All 13 types + aliases with the exact Lucide icons and RGB colors from the spec (`note` blue 8,109,221 … `quote` grey 158,158,158); background `rgba(color,0.1)`.

5. **Properties/frontmatter UI.** YAML at file top renders as the Properties editor widget in Live Preview (raw YAML in Source mode). Types per property name vault-wide: text, list, number, checkbox, date, datetime. Special keys `tags`, `aliases`, `cssclasses` (lists). Invalid YAML → visible error state, never partially rendered. Hashtags inside property text values are **not** tags. `Cmd/Ctrl+;` adds a property; template insertion **merges** properties.

6. **Tag rules.** Inline `#tag` + frontmatter `tags:`; Unicode letters/digits/`_`/`-`/`/`; must contain a non-numeric char (`#1984` is not a tag); **case-insensitive matching** with first-used-casing display; nested `#a/b` with prefix-path matching (parent matches descendants, bare child segment does not). Recognized only in body + `tags` property — never in code blocks or other property values. Click → search; tag pane with counts.

7. **Interactive checkboxes in both views.** Live Preview: real `<input type=checkbox>` widget replacing `[ ]`/`[x]`; click flips the character in the source (resolve position via `posAtDOM` at click time, `eq()` on the widget, `preventDefault` click / act on `mouseup`). Reading view: same toggle mapped back through the AST node position. `Cmd/Ctrl+Enter` toggles the checkbox under the cursor.

8. **Quick switcher + command palette.** `Cmd/Ctrl+O`: fuzzy match over note names **and aliases** (aliases marked, path shown for disambiguation); empty query → recents; `Enter` on no match **creates** the note; `Shift+Enter` force-creates; `Ctrl/Cmd+Enter` opens in new tab. `Cmd/Ctrl+P`: fuzzy commands with abbreviation matching, recents float up, hotkeys shown, pinned commands. Full default hotkey table from the core spec (Cmd+N/E/G/B/I/K, Cmd+Shift+F, Cmd+Click follows links…).

9. **Global graph feel.** Physics: center-pull `forceX/Y(0)` strength ≈ 0.52 default, repel = Barnes–Hut charge `-repelStrength` (distanceMin 30, theta 0.9), link strength `1/min(deg(s),deg(t))`, link distance 250, always-on collision (r=60, s=0.5), velocity decay 0.4; every force tweak/data change reheats alpha to 0.3; drag pins node and holds sim hot, release unpins (does not stay fixed). Node radius `nodeSize × clamp(3·√(weight+1), 8, 30)` with `√zoom` screen compensation; label fade `clamp(log2(zoom)+1−threshold, 0,1)`; hover dims non-neighbors to 0.2 alpha with ~10%/frame exponential easing + accent outline ring. Colors read from CSS variables at runtime (`--graph-node*`, `--graph-line`…) so themes restyle WebGL. Filters (search query, tags, attachments, existing-only, orphans), color groups (ordered, **first match wins**), Forces/Display sliders, settings persisted per vault mirroring `graph.json` keys.

10. **Local graph semantics.** Depth 1–5 traversal from the active note with Incoming/Outgoing/Neighbor-links toggles; neighbor-links restores full link sets among included nodes; tag nodes never traversed through; node **size encodes depth** (`30 − (30/jumps)·d`), not degree; center note gets `focused` accent color that group colors cannot override; re-centers when the active note changes.

(Honorable mentions, required for v1 but less parity-sensitive: search operator subset `file: path: tag: line: content:` + phrases/OR/negation; daily notes + `{{date:FORMAT}}` moment tokens; outline pane; `%%comments%%` visible only in editing views.)

---

## 3. Deltas to master plan §3 (Architecture) — do not edit the plan; apply during implementation

- **§3.3 Graph stack — REPLACE.** Plan says "sigma.js v3 + graphology + graphology-layout-forceatlas2 (web worker)". Research verdict: sigma/ForceAtlas2 is the **weakest** option for the Obsidian feel (converge-then-static "gravitational untangling", CPU physics, hand-wired drag). Use **`@cosmos.gl/graph@3.4.0`** (GPU sim + GPU render, MIT/OpenJS) with a thin custom React wrapper; local graph = same component with client-side filtered node/edge set. Plan an HTML label overlay (cosmos.gl has no built-in labels). Never use `@cosmograph/*` (CC-BY-NC).
- **§3.3 Next.js 15 — AMEND.** Next **15.x hits EOL 2026-10-21** (~2 months out). Either start on 16.3.x directly, or pin 15.5.23 now, heed its Next-16 deprecation warnings, and schedule the 16 upgrade as an explicit task before October. Do not ship v1 on an EOL framework.
- **§3.3 Rendering pipeline — SPECIFY.** "custom wikilink + callout + embed plugins" resolves to: `@portaljs/remark-wiki-link` (not remark-wiki-link), `rehype-callouts` (remark-obsidian-callout is unmaintained), mermaid rendered client-side (rehype-mermaid is Playwright/SSR-only and must not be bundled), `@shikijs/rehype` for code blocks. Live-preview decorations are vendored in-repo, not a dependency.
- **§3.3 Editor — SPECIFY.** Pin the CM6 set from §1.1; mount EditorView manually (no `@uiw/react-codemirror`); wikilink/hashtag as custom Lezer nodes; StateField + IME/drag guards + `atomicRanges` for block widgets.
- **§3 tree — ADD `db_selectors/` layer.** The hourly convention the plan claims to mirror is a strict three-layer `routes → services → db_selectors` (all queries in selectors, every one user/vault-scoped); the plan's tree omits `db_selectors/`. Also hourly mounts routes under `app/api/internal/routes/{domain}/` with the `/api/v1` prefix on the aggregator, not a literal `api/v1/` directory — follow hourly's layout.
- **§5 (touches §3 contract) Response envelope — CORRECT.** Plan states `{"data": …}` / `{"error": {"code","message"}}`. The hourly envelope is `BaseResponse`: success `{"success": true, "data": {...}, "message"?}`, error `{"success": false, "error": {"code","message","details"?}}`, via `CustomJSONResponse` (strips empty keys) + `ServiceResult.to_http_exception()` + global handlers. Adopt the hourly envelope verbatim.
- **§3.1 `links` table — EXTEND.** Add `is_embed bool` (`![[...]]` vs `[[...]]`) and `target_subpath text` (heading path / `^block-id`) — needed for backlinks display, section/block embeds, and graph arrows. Keep `target_title` normalized (case-folded) for unresolved matching.
- **§3.1 aliases — ADD extraction.** Quick switcher and wikilink resolution must match frontmatter `aliases`. Extract aliases on save into an indexed structure (e.g. `note_aliases(note_id, alias, uq(vault_id, lower(alias)))` or a GIN-indexed jsonb path) — `properties jsonb` alone can't serve the fuzzy-match path.
- **§3.1 graph settings persistence — ADD.** Obsidian persists graph view state (filters, groups, force sliders, zoom) per vault (`graph.json`) and local-graph state per pane. Store a `graph.json`-shaped jsonb on `vaults.settings` (and local-graph options in the persisted layout) so the panel round-trips like Obsidian's.
- **§3.2 graph payload — AMEND.** `edges:[[s,t]]` is enough for drawing but the client also needs: unresolved ghost nodes (id = normalized title), node type (`note|tag|attachment|unresolved`), and degree computed server-side (drives radius). Local graph needs no extra endpoint — the client runs the depth-traversal over the cached global payload (matches Obsidian, whose local graph derives from the full link index).
- **§3.2 link-force detail — NOTE.** Link strength depends on node degree (`1/min(deg)`), so degree must ride along with nodes in the graph payload for faithful physics tuning, not be recomputed client-side from edges only (attachments/tags toggles change effective degree).

---

## 4. Risks / gotchas

**Licensing & maintenance traps**
- `@cosmograph/cosmos` and `@cosmograph/react` are **CC-BY-NC-4.0** — installing either poisons an MIT SaaS. Only `@cosmos.gl/graph` is MIT.
- `remark-obsidian-callout` is unmaintained (its own README says so). `rehype-mermaid` uses Playwright — server-only.
- ixora is slow-moving; that's why we vendor, not depend.

**Framework timing**
- Next 15.x EOL **2026-10-21**. TypeScript must stay on 5.x (Next 15.5 rejects TS ≥ 7). Tailwind v4 has no `tailwind.config.js` — old v3 recipes/snippets silently don't apply.

**cosmos.gl specifics**
- Requires **WebGL2**; README flags an iOS Safari regression on the many-body extension — test iPad; keep a "reduced motion / static layout" fallback path.
- 561 kB min (144 kB gz) — must be `next/dynamic` code-split, never in the shared bundle.
- Its force model is not d3-force. Obsidian's sliders (`centerStrength`, `repelStrength` 0–20, `linkStrength` 0–1, `linkDistance` 30–500) need an explicit mapping layer to cosmos.gl config, tuned side-by-side against a real vault in Obsidian; also emulate the non-exposed constants (collision r=60/s=0.5, velocityDecay 0.4, reheat-to-0.3) or the graph will feel subtly wrong.
- Drag semantics: Obsidian **unpins on release** (node does not stay fixed) — verify cosmos.gl `enableDrag` matches; hold the sim hot during drag.

**Live Preview correctness (the classic failure modes)**
- Missing `input.type.compose` guard breaks CJK IME input; missing `select.pointer` guard causes flicker during drag-select.
- Block replace decorations from a ViewPlugin (instead of StateField) break vertical layout.
- Widgets without `eq()` lose checkbox focus/DOM on every keystroke; positions captured at decoration build time go stale — always `posAtDOM` at event time.
- Heading font sizing must come from line classes, not hidden-text presence, or line heights jump as the cursor moves.
- KaTeX/mermaid widget rendering must be memo-cached by source text and shared with Reading view, or typing near a math block re-renders it every keystroke.

**Parity subtleties that bite late**
- Wikilink resolution is case-insensitive and alias-aware; rename must rewrite links across the vault (transactional, plus link-table resync).
- Tag matching is prefix-path based (`#inbox` matches `#inbox/to-read`, `read` does not); tags are case-insensitive but display-preserving — normalize at extraction, keep display casing.
- Graph group colors are ordered first-match-wins; focused node color beats group colors.
- Graph colors must be read from CSS variables at runtime (Obsidian's `testCSS()` trick) so theme switching restyles the canvas without a reload.
- Obsidian's search operator surface (`block:`, `section:`, `task:`, property queries) far exceeds Postgres FTS out of the box — scope v1 to `file: path: tag: content: line:` + phrases/OR/negation/regex and say so, rather than shipping half-working operators.
- `%%comments%%` must never render in Reading view; hashtags in code blocks are not tags; `#1984` is not a tag.

**Backend/infra**
- Graph Redis cache (`graph:{vault_id}`) needs explicit invalidation on **every** note/link/folder write path, not just note save — rename/move/delete all change edges.
- If the react-force-graph or pixi+d3-worker fallback is ever used with `SharedArrayBuffer`, it requires COOP/COEP headers — an ingress-level change; cosmos.gl avoids this entirely (GPU sim, no worker).
- Auth: keep FastAPI the sole enforcement point; Next middleware is UX-only (CVE-2025-29927 lesson). Refresh cookie `Path`-scoped to the refresh endpoint; access token in memory only, never localStorage.
