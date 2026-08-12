# Graph Rendering Stack Research — Force-Directed Knowledge Graph (10k+ nodes)

**Date:** 2026-08-12
**Target:** React 19 / Next 15 app, Obsidian-style animated graph view — live force simulation, nodes settle organically, draggable, hover-neighbor highlight, smooth at 10k+ nodes/edges. License must be permissive OSS.

**Reference point:** Obsidian's own graph view is pixi.js (WebGL) for rendering + d3-force physics run in a Web Worker — GPU draws, CPU (off-main-thread) simulates.

---

## TL;DR Decision

| | Package(s) | Verdict |
|---|---|---|
| **WINNER** | `@cosmos.gl/graph@3.4.0` (MIT, OpenJS Foundation) + thin custom React wrapper | Only option where *both* simulation and rendering run on the GPU — the live, springy, draggable Obsidian feel stays 60fps well past 10k nodes (proven to 100k–1M+). |
| **Runner-up** | `react-force-graph-2d@1.29.1` (→ `force-graph@1.51.4`, MIT) | Best DX and the most literal Obsidian physics (d3-force), but CPU main-thread simulation + Canvas 2D caps "smooth" at roughly 2–5k nodes. Great fallback / prototyping layer. |

Do **not** use `@cosmograph/cosmos@3.4.1` or `@cosmograph/react@2.5.0` — both relicensed to **CC-BY-NC-4.0** (non-commercial). The MIT lineage lives on as **cosmos.gl** (`@cosmos.gl/graph`), donated to the OpenJS Foundation in 2025.

---

## Candidates Compared

### 1. sigma.js v3 + graphology (+ ForceAtlas2 worker)

Packages: `sigma@3.0.3` (2026-04-30), `graphology@0.26.0`, `graphology-layout-forceatlas2@0.10.1`, React bindings `@react-sigma/core@5.0.6` (2025-12-01).

- **WebGL:** Yes — custom WebGL node/edge programs; renders 10k nodes / 100k edges fine with default styles.
- **React 19 / Next 15:** `@react-sigma/core` peer-deps `react ^18 || ^19` — explicit React 19 support. Client-only (`dynamic(..., { ssr: false })`).
- **Obsidian feel:** Weakest of the group. ForceAtlas2 is a layout algorithm, not a spring-embedder game loop — it runs in a worker (`graphology-layout-forceatlas2/worker`) and you watch positions converge, but the motion is "gravitational untangling," not the bouncy settle of d3-force. Drag-while-simulating is possible but hand-wired (pin node in FA2, sync coords). Physics itself is **CPU**; FA2 speed degrades past ~50k edges.
- **Hover highlight:** Via `nodeReducer`/`edgeReducer` + `refresh({ skipIndexation: true })` — the canonical pattern; at 10k+ nodes reducers re-run over the whole graph per hover, needs care but workable.
- **Bundle:** sigma 94 kB min / 25.5 kB gz + graphology 65 kB / 13 kB gz — smallest full-featured stack.
- **Maintenance:** Active (Sciences-Po médialab / OuestWare; v4 in alpha). **License:** MIT.
- **Best at:** label rendering (smart label grid), *settled* graph exploration, small bundles. Not at live physics feel.

### 2. react-force-graph / force-graph (d3-force + Canvas)

Packages: `react-force-graph-2d@1.29.1` (2026-02-04, peer `react: *`) wrapping `force-graph@1.51.4` (2026-04-16). Sibling `3d-force-graph@1.80.x` is three.js/WebGL but 3D — not the Obsidian look.

- **WebGL:** **No** for 2D — Canvas 2D rendering. (WebGL only in the 3D variant.)
- **React 19 / Next 15:** Works (peer `react: *`, actively released through 2026); client-only via dynamic import.
- **Obsidian feel:** **Best-in-class out of the box** — continuous d3-force simulation with alpha decay, built-in node dragging with reheat, organic settle, pan/zoom. This *is* the Obsidian physics model.
- **The catch:** d3-force ticks on the **main thread** and Canvas 2D repaints every frame. Practical smoothness ceiling ≈ 2–5k nodes; at 10k+ ticks hit 15–30 ms and interaction stutters. No built-in worker offload.
- **Hover highlight:** Trivial (`onNodeHover` + custom `nodeCanvasObject`); cost is the full-canvas repaint you're already paying.
- **Bundle:** force-graph 174 kB min / 57 kB gz.
- **Maintenance:** Very active (vasturiano). **License:** MIT.

### 3. cosmos.gl — `@cosmos.gl/graph` (GPU simulation + GPU rendering) — WINNER

Package: `@cosmos.gl/graph@3.4.0` (2026-07-27, MIT, OpenJS Foundation project; built on luma.gl 9.3, WebGL2).

- **WebGL:** Yes — and uniquely, the **force simulation itself runs in WebGL2 shaders**. No CPU tick, no worker needed, no CPU↔GPU transfer per frame. Real-time simulation of hundreds of thousands of points/links; 10k nodes is trivial headroom.
- **React 19 / Next 15:** Framework-agnostic vanilla TS — wrap in a ~40-line `'use client'` component (`new Graph(div, config)` in an effect, `setPointPositions`/`setLinks`, destroy on unmount). No peer-dep friction ever. (No official React wrapper; `@cosmograph/react` exists but is CC-BY-NC — avoid.)
- **Obsidian feel:** Excellent — live many-body/link/gravity forces, organic settle, `enableDrag: true` for node dragging, `start()/pause()/unpause()/stop()` + `restart()` for reheat control. Arguably *more* alive than Obsidian at scale because physics never throttles.
- **Hover highlight:** First-class and GPU-cheap: `onPointMouseOver`, `getNeighboringPointIndices()`, `getConnectedLinkIndices()`, `highlightedPointIndices` / `highlightedLinkIndices` / `outlinedPointIndices`, greyed-out ring/opacity states.
- **Gaps to plan for:** (a) **No built-in text labels** — render top-N visible labels as an HTML/CSS overlay (what Cosmograph does, e.g. via `@interacta/css-labels` or your own absolutely-positioned divs using `getTrackedPointPositionsMap()`/screen-space transforms); (b) needs **WebGL2** (universal on 2026 desktop browsers; note README flags an iOS Safari regression on the many-body WebGL extension — test on iPad if that matters); (c) bundle is heavier: 561 kB min / 144 kB gz (luma.gl inside).
- **Maintenance:** Very active (release 10 days before this research), OpenJS Foundation governance — strongest long-term signal here. **License:** MIT. Powers the Cosmograph product.

### 4. d3-force + custom canvas (DIY)

`d3-force@3.0.0` (ISC, stable/frozen since 2021, 15 kB min). You own rendering, hit-testing, zoom/pan (d3-zoom), drag (d3-drag), labels, highlight. Same main-thread ceiling as force-graph unless you also write the Web Worker + transferable-Float32Array plumbing yourself. Verdict: maximum control, weeks of work, and you still end up CPU-bound at 10k unless you rebuild Obsidian's worker architecture. Not worth it when cosmos.gl exists.

### 5. pixi.js + d3-force (the literal Obsidian stack)

`pixi.js@8.19.0` (2026-06-04, MIT, active) + `d3-force@3.0.0` in a Web Worker. This is exactly Obsidian's architecture: WebGL sprite/mesh rendering (edges as one line-list mesh, positions written into a vertex buffer) with physics off the main thread — 10k+ nodes at 50+ fps is proven. But it's a framework, not a graph library: you build the worker protocol, quadtree picking, drag, culling, LOD labels, highlight states from scratch. Bundle 859 kB min / 246 kB gz (pixi is tree-shakeable to less). Verdict: the right choice only if you need pixel-perfect custom rendering control; otherwise cosmos.gl gives the same (better) result for ~5% of the effort.

---

## Scorecard

| Criterion | sigma v3 | react-force-graph-2d | **cosmos.gl** | d3+canvas DIY | pixi+d3 DIY |
|---|---|---|---|---|---|
| Rendering | WebGL | Canvas 2D | **WebGL2** | Canvas 2D | WebGL |
| Physics location | CPU worker (FA2) | CPU main thread | **GPU shaders** | CPU | CPU worker (DIY) |
| Smooth live sim @10k+ | Partial (converge-then-static) | No (~2–5k cap) | **Yes (100k+)** | No | Yes (if built well) |
| Obsidian feel (organic settle + drag) | Fair | **Excellent** | **Excellent** | DIY | Excellent (DIY) |
| Hover neighbor highlight @10k | OK (reducers) | Easy but repaint-bound | **Built-in, GPU-cheap** | DIY | DIY |
| React 19 / Next 15 | Yes (`@react-sigma` 5) | Yes | Yes (thin wrapper) | Yes | Yes |
| Built-in labels | **Yes (smart)** | Yes (canvas) | No (HTML overlay) | DIY | DIY |
| Bundle (min/gz) | 160/38 kB w/ graphology | 174/57 kB | 561/144 kB | ~20/7 kB | 859/246 kB |
| Maintenance (Aug 2026) | Active | Active | **Very active, OpenJS** | Frozen-stable | Active |
| License | MIT | MIT | **MIT** | ISC | MIT |
| Integration effort | Medium | **Low** | Low-medium | High | Very high |

---

## Recommendation

**(a) Animated Obsidian-feel graph at 10k+ nodes — WINNER: cosmos.gl**

```
npm i @cosmos.gl/graph@3.4.0
```

- Wrap in a small `'use client'` React component; load with `next/dynamic({ ssr: false })`.
- GPU simulation gives the live, springy, draggable Obsidian motion with an order-of-magnitude headroom over every CPU option; hover-neighbor highlight is built-in and free.
- Plan a lightweight HTML label overlay (top-N visible nodes by degree/zoom) — the one real gap.
- MIT under the OpenJS Foundation; do **not** confuse it with the non-commercial `@cosmograph/*` packages.

**Runner-up: `react-force-graph-2d@1.29.1` + `force-graph@1.51.4`** — if graphs will usually stay under ~3–5k nodes, this gets the identical feel in an afternoon with first-class React ergonomics; it is also a good scaffolding layer while the cosmos.gl wrapper is built. Keep `sigma@3.0.3 + @react-sigma/core@5.0.6` on the shelf only if the product pivots to *static* exploration of very large labeled graphs.

## Sources

- https://github.com/cosmosgl/graph (README: GPU sim, drag, highlight APIs, MIT, WebGL2/luma.gl)
- https://openjsf.org/blog/introducing-cosmos-gl (OpenJS Foundation donation, 1M-node claims)
- https://www.npmjs.com/package/@cosmograph/cosmos (CC-BY-NC-4.0 relicense — avoid)
- https://www.sigmajs.org/docs/ and https://github.com/jacomyal/sigma.js (WebGL, MIT, v4 alpha)
- https://www.npmjs.com/package/react-force-graph / https://github.com/vasturiano/react-force-graph
- https://graphaware.com/blog/scale-up-your-d3-graph-visualisation-webgl-canvas-with-pixi-js/ and https://dianaow.com/posts/pixijs-d3-graph (pixi+d3-force architecture, Obsidian-style worker/vertex-buffer patterns)
- npm registry + bundlephobia API queries, 2026-08-12 (versions, dates, licenses, sizes)
