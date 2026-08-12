# Obsidian Graph View — Full Behavioral Specification

Research date: 2026-08-12.
Sources: official help docs (obsidian.md/help/plugins/graph), Obsidian changelogs,
docs.obsidian.md CSS variable reference, real `.obsidian/graph.json` files, and a
**direct decompilation of Obsidian Publish's graph engine** (`publish.obsidian.md/app.js`
+ its physics worker `publish.obsidian.md/sim.js`), which is built from the same graph
codebase as the desktop app. Facts extracted from that bundle are marked **[engine]** and
are exact. Facts only reported by community/UI observation are marked **[reported]**.

---

## 1. Architecture overview

- Rendering: **Pixi.js (WebGL)** on a `<canvas>`. The Publish bundle loads
  `pixi.min.js?7.2.4` (Pixi v7.2.4), `new PIXI.Application({antialias: true,
  backgroundAlpha: 0, autoStart: false})`. **[engine]**
- Rendering is on-demand, not a continuous loop: every state change calls
  `changed()` → `requestAnimationFrame`; an `idleFrames` counter lets it stop
  re-rendering when nothing moves. **[engine]**
- Physics: runs **off the UI thread in a Web Worker** (named "Graph Worker",
  `sim.js`). The worker contains **two simulators**:
  1. a hand-rolled **WebAssembly module** (embedded base64 `.wasm`, exports:
     `memset, init, complete, visitCharge, visitCollide, manyBody, simulate`) —
     the primary path;
  2. a bundled **d3-force + d3-quadtree fallback** (logs
     `"Using fallback d3 simulator"` when WASM is unavailable). **[engine]**
- Worker → main thread position transfer: a `Float32Array` of interleaved
  `x,y` pairs plus an id array, sent through a **SharedArrayBuffer** (with a
  version counter) when available, otherwise a transferable `ArrayBuffer`,
  at up to 60 physics ticks/sec (`setTimeout(1000/60)`). **[engine]**
- Colors are not hardcoded: the renderer reads them **from the DOM at runtime**
  (see §10) so themes/snippets restyle the WebGL scene.

---

## 2. Global graph vs local graph

| | Global graph | Local graph |
|---|---|---|
| Open with | "Graph view: Open graph view" command (default hotkey Ctrl/Cmd+G [reported]) or ribbon icon | "Graph view: Open local graph" command; opens in a new pane, typically docked next to the note |
| Shows | Every note in the vault (subject to filters) | Only notes connected to the **active note**, up to N jumps |
| Follows active file | No | Yes — re-centers whenever the active note changes |
| Settings persistence | `.obsidian/graph.json` (global, one per vault) | Stored per-leaf in `workspace.json` (this is why local-graph settings don't persist the way users expect — long-standing forum complaint) |
| Extra options | Orphans toggle | Depth slider + Incoming/Outgoing/Neighbor-links toggles; no Orphans toggle |
| Center note styling | n/a | The active note has node type `"focused"` and is painted with the accent color (`--graph-node-focused`) |
| Node sizing | By degree (link count) | By **depth**, not degree — see §9 |

Both variants share the same renderer, physics, and settings panel structure.

---

## 3. Filters section

Settings panel → "Filters" (collapsible; `collapse-filter` in graph.json).

1. **Search files** (`search`: string) — free-text filter over vault files.
   Uses Obsidian's full search engine and syntax:
   - operators: `file:`, `path:`, `content:`, `tag:` (or bare `#tag`),
     `line:`, `block:`, `section:`, `task:`, `task-todo:`, `task-done:`,
     `match-case:`, `ignore-case:`, `property:` (1.4+)
   - boolean: implicit AND, explicit `OR`, negation `-term`, exact phrases
     `"..."`, grouping `(...)`, regex `/.../` (JavaScript flavor)
   - Common graph idioms: `path:Projects`, `-path:Templates`, `tag:#area`,
     `file:.png`.
   Only matching files (and links among them) are shown.
2. **Tags** (`showTags`: bool, default false) — when on, every tag becomes its
   own node (type `"tag"`) with a link from each file containing it. Tag nodes
   are never expanded through in local-graph traversal (tags don't propagate
   depth). **[engine]**
3. **Attachments** (`showAttachments`: bool, default false) — when on,
   non-markdown files (images, PDFs, …) appear as nodes (type
   `"attachment"`); when off, non-`.md` files and links to them are skipped
   entirely. **[engine]**
4. **Existing files only** (`hideUnresolved`: bool, default false) — when on,
   hides **unresolved links** (links to notes that don't exist yet). When off,
   each unresolved target is materialized as a ghost node of type
   `"unresolved"`. **[engine]**
5. **Orphans** (`showOrphans`: bool, default true) — global graph only;
   toggles notes that have no links at all.

---

## 4. Groups section (color by query)

Settings panel → "Groups" (`collapse-color-groups`; `colorGroups` array).

- "New group" adds a row: a **search query input** + a **color swatch**.
  The query uses the same search syntax as the filter (in practice `path:`,
  `file:`, `tag:`/`#tag`, plain text, `-negation`, `OR` all work).
- Clicking the swatch opens a color picker (hue slider + custom color; the
  underlying value is an RGB int). Stored format:

```json
"colorGroups": [
  { "query": "path:Projects", "color": { "a": 1, "rgb": 13193952 } }
]
```

  `rgb` is a 24-bit integer (e.g. `13193952` = `0xC95AE0`), `a` is alpha 0–1.
- A node matching a group's query is filled with that group's color. Groups are
  evaluated in list order; the **first matching group wins** — drag/order
  matters. **[reported]**
- Precedence in the renderer (`getFillColor`) **[engine]**:
  1. currently hovered node → highlight color
  2. node type `"focused"` (local graph's center note) → focused/accent color
     (group colors do NOT override the focused node)
  3. **group color** (overrides tag/unresolved/attachment coloring)
  4. type `"tag"` → tag color; `"unresolved"` → unresolved color;
     `"attachment"` → attachment color
  5. default node color.
- Local graphs keep their own independent group list.

---

## 5. Display section

Settings panel → "Display" (`collapse-display`).

| UI label | graph.json key | Default | Range [reported] | Exact behavior [engine] |
|---|---|---|---|---|
| Arrows | `showArrow` | false | on/off | Draws a small triangle at the target end of each link showing direction; see §11.4 |
| Text fade threshold | `textFadeMultiplier` | 0 | −3 … +3 | Shifts the zoom level at which labels appear: `textAlpha = clamp(log2(zoom) + 1 − threshold, 0, 1)` — labels fade in over one octave of zoom; higher threshold ⇒ must zoom in further to see text |
| Node size | `nodeSizeMultiplier` | 1 | 0.1 … 5 | Linear multiplier on node radius (see §9) |
| Link thickness | `lineSizeMultiplier` | 1 | 0.1 … 5 | Link screen-pixel width = `lineSizeMultiplier` (world width is `mult / zoom`, so thickness is zoom-independent); arrow size scales with `2·√mult` |
| Animate | — (button) | — | — | Starts the time-lapse animation (§12). Button lives at the bottom of Display; when the settings panel is closed a "magic wand" icon triggers it |

Also in the panel: a **"Restore default settings"** reset button and a close
button. The current zoom is persisted as `scale`, panel-open state as `close`.

---

## 6. Forces section

Settings panel → "Forces" (`collapse-forces`). Exact mapping onto the
simulation (fallback d3 path; the WASM sim mirrors it) **[engine]**:

| UI label | graph.json key | Default | Range [reported] | Simulation meaning [engine] |
|---|---|---|---|---|
| Center force | `centerStrength` | 0.518713248970312 | 0 … 1 | Strength of `forceX(0)` + `forceY(0)` (positional pull of every node toward origin, NOT d3's forceCenter). Value used verbatim as the d3 strength |
| Repel force | `repelStrength` | 10 | 0 … 20 | Barnes–Hut many-body charge: `strength = −repelStrength` (floored at −1), `distanceMin = 30`, `theta = 0.9`, `distanceMax = ∞` |
| Link force | `linkStrength` | 1 | 0 … 1 | Multiplier on d3's default link strength `1 / min(degree(source), degree(target))` |
| Link distance | `linkDistance` | 250 | 30 … 500 | Target rest length of each link (px, world space) |

Additional forces/parameters that are **always on and not exposed in the UI**
**[engine]**:

- **Collision force**: `forceCollide(radius = 60, strength = 0.5)` — nodes
  softly resist overlapping within a 60 px radius.
- **Velocity decay**: `0.4` (velocities multiplied by `0.6` each tick — d3
  default).
- **Alpha schedule**: alpha floor `0.001` (simulation stops below it);
  `alpha += (alphaTarget − alpha) × alphaDecay` per tick (d3-standard decay);
  ticks at 60 Hz.
- Dragging a slider posts `{forces, alpha: 0.3, run: true}` to the worker —
  i.e. every force tweak **reheats the simulation to alpha 0.3** and the
  layout visibly re-settles in real time.

---

## 7. Local graph specifics

Local-graph-only options (per-leaf keys in workspace.json) **[engine]**:

| UI label | key | Default |
|---|---|---|
| Depth (slider, top of Filters) | `localJumps` | 1 (range 1–5) |
| Incoming links (toggle) | `localBacklinks` | true |
| Outgoing links (toggle) | `localForelinks` | true |
| Neighbor links (toggle) | `localInterlinks` | false |

Exact traversal algorithm (decompiled) **[engine]**:

1. Start set = { active file }, weight 30, type `"focused"`.
2. Repeat `localJumps` times (depth d = 1 … jumps):
   - if **Outgoing links**: for every included node i (except tag nodes),
     add link targets of i not yet included;
   - if **Incoming links**: for every file i in the vault linking to an
     included node, add i;
   - every node added at depth d gets **weight = 30 − (30 / jumps) · d**
     (linear falloff; nodes at max depth have weight → 0).
3. If **Neighbor links**: after collecting nodes, restore each included
   node's *full* link set from the global graph — this reveals
   cross-links between neighbors that don't pass through the center note.
   With it off, only links on traversal paths are drawn.
4. Tag nodes are included (if Tags is on) but never traversed through.

Consequence: in the local graph **node size encodes distance from the center
note** (center biggest), not link count — the precomputed `weights` map
overrides the degree-based weight. **[engine]**

---

## 8. Interactions

All decompiled from the engine unless noted:

- **Hover a node**: it becomes `highlightNode`. Target alpha 1.0 for the
  hovered node and its direct neighbors (forward or reverse link); **all other
  nodes and non-adjacent links dim to alpha 0.2**. Alphas ease exponentially
  (10 %/frame — `a = 0.9·a + 0.1·target`), so the dim/undim is an animated
  fade, not a snap. The hovered node also gets an **outline ring** (color
  `--graph-node-focused` / class `color-circle`, width `max(1, 1/zoom/nodeScale)`
  px) and its label: forced to full opacity, slides down 15 px (eased), and is
  kept ≥ 1:1 size when zoomed out. Links touching the hovered node switch
  color to `color-line-highlight` (per-channel RGB lerp, same easing).
- **Hover + Ctrl/Cmd**: Page Preview popover of the note (Page Preview core
  plugin; a setting controls whether the modifier is required for graph view).
  Touch pointers never trigger hover.
- **Click a node**: opens the note. Click = press + release with pointer
  travel < 5 px (engine tracks `dx²+dy² > 25` to cancel). Left (button 0) and
  middle (button 1) clicks count. **Ctrl/Cmd+click opens in a new tab/pane**
  [reported].
- **Right-click a node**: context menu (open in new tab / new window, etc.).
- **Drag a node**: pins it to the cursor (`fx/fy` set each move) and posts
  `{alpha: 0.3, alphaTarget: 0.3, run: true, forceNode:{id,x,y}}` — the
  simulation stays "hot" while dragging so the rest of the graph swims around
  the pinned node. On release: `{alphaTarget: 0, forceNode:{id, x:null,
  y:null}}` — node unpins (it does NOT stay fixed) and the layout cools back
  down.
- **Drag empty space**: pans the viewport.
- **Scroll wheel**: zooms. `targetZoom ×= 1.5^(−deltaY/120)`; deltaMode
  line/page multiplied by 40/800. Zoom is **eased** (`zoom = 0.85·zoom +
  0.15·target` per frame), anchored at the **cursor position when zooming in**
  and at the view center when zooming out. Zoom clamps to **[1/128, 8]**.
- **Keyboard**: arrow keys pan, holding Shift pans faster, `+`/`-` zoom
  (official help).
- **Pinch** (trackpad/touch): zoom; two-finger drag pans.

---

## 9. Node size ↔ link count mapping

Exact formula **[engine]**:

```
weight  = number of distinct related nodes (forward links + backlinks;
          tags and attachments count when shown)          // global graph
weight  = 30 − (30/jumps)·depth                           // local graph (see §7)

radius  = nodeSizeMultiplier × clamp(3·√(weight + 1), 8, 30)   // world px
```

- Minimum radius 8 (an orphan: 3·√1 = 3 → clamped to 8; nodes with degree ≤ 6
  all render at 8), maximum 30 (reached at degree 99); square-root growth in
  between. The Node size slider scales the result linearly.
- The node circle is a 100 px-radius texture scaled to `radius/100`.
- **Zoom compensation**: on-screen node radius = `radius × √zoom` (the engine
  multiplies world size by `nodeScale = √(1/zoom)`), i.e. nodes grow slower
  than the graph when zooming in and shrink slower when zooming out.
- Label font size = `14 + radius/4` px, drawn below the node at offset
  `(radius + 5) × nodeScale`.

---

## 10. Colors (default dark theme)

### Pipeline **[engine]**

CSS is the source of truth. On init and on every theme change the renderer
calls `testCSS()`: for each color role it creates a hidden
`<div class="graph-view color-…">`, reads computed `color` and `opacity`,
packs them into `{rgb: 24-bit int, a: alpha}` for WebGL, then removes the div.
Fallback if a color can't be parsed: `0x888888`.

Color roles (class → meaning):

| Class | Role |
|---|---|
| `color-fill` | default node fill |
| `color-fill-focused` | focused node (local graph center); disabled if alpha is 0 |
| `color-fill-tag` | tag nodes |
| `color-fill-unresolved` | unresolved (ghost) nodes |
| `color-fill-attachment` | attachment nodes |
| `color-fill-highlight` | hovered node fill |
| `color-line-highlight` | links touching hovered node |
| `color-line` | link lines |
| `color-arrow` | arrowheads |
| `color-circle` | hover outline ring |
| `color-text` | labels |

### CSS variables → resolved dark-theme values

From Obsidian's shipped app.css (verified against the live bundle):

| Variable | Defined as | Default **dark** value | Default light value |
|---|---|---|---|
| `--graph-node` (resolved note) | `var(--text-muted)` = base-70 | **#b3b3b3** (light gray) | #5c5c5c-ish (base-70 light) |
| `--graph-node-unresolved` (ghost) | `var(--text-faint)` = base-50 | **#666666** (darker gray → reads as "faded") | #999-ish |
| `--graph-node-focused` | `var(--text-accent)` | **accent purple** — base accent `hsl(258, 88%, 66%)` ≈ `#8a5cf5` (dark theme uses accent-1 ≈ `#9873f7`) | accent |
| `--graph-node-tag` | `var(--color-green)` | **#44cf6e** (green) | #08b94e |
| `--graph-node-attachment` | `var(--color-yellow)` | **#e0de71** (pale yellow) | #e0ac00 |
| `--graph-line` | `var(--color-base-35, var(--background-modifier-border-focus))` | **#3f3f3f** (near-background gray) | ~#e0e0e0 |
| `--graph-text` | `var(--text-normal)` | **#dadada** | #222 |
| `--graph-controls-width` | 240px | — | — |

Notes:
- Hover-highlight fill and line-highlight resolve to the **accent color** in
  the default theme (hence the purple glow of hovered connections).
- Unresolved nodes are distinguished purely by their fainter gray (plus
  historically a 0.5 opacity on `color-fill-unresolved`); they are the same
  shape/size rules as normal nodes.
- Dark theme background behind the graph: `--color-base-00` = #1e1e1e
  (canvas itself is transparent, `backgroundAlpha: 0`).

---

## 11. How Obsidian animates the graph

### 11.1 Force-simulation animation **[engine]**

- The worker steps the simulation at up to 60 Hz while `alpha > 0.001`,
  streaming positions each tick; the Pixi layer re-renders on arrival. When
  alpha decays below the floor the sim goes idle and rendering stops (zero
  CPU at rest).
- **Reheat triggers** (alpha is only ever raised, never cut):
  - graph data changed (nodes/links added or removed): `alpha → 0.3`
  - any Forces slider changed: `alpha → 0.3`
  - node drag: `alpha → 0.3` **and** `alphaTarget → 0.3` (held hot while
    dragging); release sets `alphaTarget → 0` so it cools naturally.
- **Initial placement** of new nodes: a node with already-placed neighbors
  spawns at the **centroid of its neighbors** plus uniform jitter in a
  square of side `60·√T` (T = number of new nodes); a node with no placed
  neighbors spawns at a uniform-area random point in an annulus just outside
  the current graph radius. This is why loading a big graph looks like an
  explosion from the middle that settles outward.
- **Presentation easing** (independent of physics): node/link opacities,
  link colors, hover dim/undim, label slide, and zoom all converge
  exponentially at ~10–15 % per frame (`lerp(a, target, 0.9)` /
  zoom `0.85`). Nodes fade in from alpha 0 when first rendered; links fade
  in from 20 % alpha.
- Arrows additionally fade with zoom: `alpha × clamp(2·(zoom − 0.3), 0, 1)`
  — invisible below 30 % zoom, fully opaque at 80 %.

### 11.2 "Animate" time-lapse feature

- Button at the bottom of Display (or the **magic wand icon** when the
  settings panel is collapsed).
- Replays vault history: the graph **starts empty** and notes/attachments
  **appear in chronological order of file creation time** (since v0.12.13);
  orphans need not be hidden. Each appearing node joins the live physics
  simulation (spawn + reheat as in §11.1), producing the classic growing-
  organism effect.
- No built-in speed control or timeline scrubber (long-standing feature
  requests).
- Caveat: uses filesystem creation time, so re-created/moved files can reset
  their position in the timeline.

### 11.3 Rendering details worth copying

- Links are 1×1 white sprites stretched between node rims (length =
  center distance − both radii), rotated, tinted; width = thickness/zoom so
  screen thickness is constant.
- Arrowheads: triangle path `(0,0) (−4,−2) (−3,0) (−4,2)` placed at the
  target rim + 1 px, rotated along the link, scale `2·√(thickness)/zoom`.
  For a reciprocal pair (A↔B) only one line is drawn (deduped by id
  comparison).
- Aggressive culling: nodes/links outside the viewport (with small margins)
  are hidden; labels are culled with a larger box (±300 px horizontal).

---

## 12. graph.json reference (global graph)

`.obsidian/graph.json`, written on every settings change:

```json
{
  "collapse-filter": true,          // Filters section collapsed?
  "search": "",                     // filter query
  "showTags": false,
  "showAttachments": false,
  "hideUnresolved": false,          // "Existing files only"
  "showOrphans": true,
  "collapse-color-groups": true,
  "colorGroups": [                  // ordered; first match wins
    { "query": "tag:#x", "color": { "a": 1, "rgb": 14701138 } }
  ],
  "collapse-display": true,
  "showArrow": false,
  "textFadeMultiplier": 0,          // −3..3
  "nodeSizeMultiplier": 1,          // 0.1..5
  "lineSizeMultiplier": 1,          // 0.1..5
  "collapse-forces": true,
  "centerStrength": 0.518713248970312,  // 0..1
  "repelStrength": 10,              // 0..20
  "linkStrength": 1,                // 0..1
  "linkDistance": 250,              // 30..500
  "scale": 1.0,                     // saved zoom
  "close": false                    // controls panel closed?
}
```

Local graph adds (per-leaf, in workspace.json): `localJumps` (1–5),
`localBacklinks`, `localForelinks`, `localInterlinks`, plus its own copies of
the shared options.

---

## 13. Confidence notes

- **Exact [engine]**: all formulas, force parameters, easing constants, drag/
  zoom/hover mechanics, color pipeline, local-graph traversal — decompiled
  from Obsidian Publish's graph bundle (same codebase family as desktop).
  Desktop may differ in minor ways (it has the settings UI, timelapse, and
  keyboard handling that Publish lacks; its primary simulator is the WASM
  module).
- **[reported]** slider min/max ranges and group first-match-wins ordering:
  consistent with observed graph.json values and community documentation, but
  not verifiable from the Publish bundle (which ships no settings UI).
- Default `centerStrength` 0.518713… appears verbatim in fresh vaults.
