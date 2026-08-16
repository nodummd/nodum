"use client";

/**
 * A working miniature of the product, on the landing page: the same
 * @cosmos.gl/graph engine the app renders vaults with, wired to a small
 * explorer. Colour a folder and its notes change colour in the graph —
 * the actual feature, not a picture of it.
 *
 * The engine is imported only when the section scrolls into view, so the
 * landing page's first load never pays for WebGL. Anything that can't run it
 * (reduced motion, no WebGL, import failure) gets the screenshot instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Graph as CosmosGraph } from "@cosmos.gl/graph";

import { cn } from "@/lib/utils";

const SPACE = 4096;

/** Swatches, drawn from the logo's own strand. */
const SWATCHES = [
  { name: "Azure", value: "#3790ff" },
  { name: "Violet", value: "#a497ff" },
  { name: "Magenta", value: "#c56bff" },
  { name: "Green", value: "#2ecc9b" },
  { name: "Amber", value: "#f7b731" },
];

const FOLDERS = [
  { id: "research", name: "Research", color: "#3790ff" as string | null },
  { id: "writing", name: "Writing", color: "#c56bff" as string | null },
  { id: "projects", name: "Projects", color: "#2ecc9b" as string | null },
  // Deliberately uncoloured: the empty swatch is the invitation to try it.
  { id: "journal", name: "Journal", color: null as string | null },
];

/** A small vault that actually hangs together — every link resolves. */
const NOTES: { title: string; folder: string; links: string[] }[] = [
  { title: "Knowledge graphs", folder: "research", links: ["Zettelkasten", "Graph layout", "Wikilinks"] },
  { title: "Zettelkasten", folder: "research", links: ["Atomic notes", "Second brain"] },
  { title: "Atomic notes", folder: "research", links: ["Evergreen notes", "Linking heuristics"] },
  { title: "Graph layout", folder: "research", links: ["Force-directed drawing"] },
  { title: "Force-directed drawing", folder: "research", links: ["Graph layout"] },
  { title: "Spaced repetition", folder: "research", links: ["Atomic notes"] },
  { title: "Second brain", folder: "writing", links: ["Maps of content", "Evergreen notes", "Daily notes"] },
  { title: "Maps of content", folder: "writing", links: ["Knowledge graphs", "Weekly review"] },
  { title: "Evergreen notes", folder: "writing", links: ["Linking heuristics"] },
  { title: "Linking heuristics", folder: "writing", links: ["Wikilinks"] },
  { title: "Wikilinks", folder: "writing", links: ["Knowledge graphs"] },
  { title: "Editing checklist", folder: "writing", links: ["Second brain"] },
  { title: "Nodum roadmap", folder: "projects", links: ["Plugin API", "Mobile layout", "Graph colours"] },
  { title: "Plugin API", folder: "projects", links: ["Nodum roadmap"] },
  { title: "Mobile layout", folder: "projects", links: ["Nodum roadmap"] },
  { title: "Graph colours", folder: "projects", links: ["Graph layout", "Knowledge graphs"] },
  { title: "Weekly review", folder: "projects", links: ["Daily notes", "Maps of content"] },
  { title: "Daily notes", folder: "journal", links: ["Weekly review", "Second brain"] },
  { title: "Monday", folder: "journal", links: ["Daily notes", "Nodum roadmap"] },
  { title: "Tuesday", folder: "journal", links: ["Daily notes", "Editing checklist"] },
  { title: "Wednesday", folder: "journal", links: ["Daily notes", "Spaced repetition"] },
];

const INDEX_OF = new Map(NOTES.map((n, i) => [n.title, i]));

const EDGES: [number, number][] = NOTES.flatMap((note, i) =>
  note.links
    .map((title) => INDEX_OF.get(title))
    .filter((j): j is number => j !== undefined && j !== i)
    .map((j) => [i, j] as [number, number]),
);

const DEGREE = NOTES.map((_, i) => EDGES.filter(([s, t]) => s === i || t === i).length);

const ADJACENCY: number[][] = NOTES.map((_, i) =>
  EDGES.flatMap(([s, t]) => (s === i ? [t] : t === i ? [s] : [])),
);

const NEUTRAL = "#8f8aa6";
const ACCENT = "#ece9f5";

function rgba(hex: string, alpha = 1): [number, number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
    alpha,
  ];
}

export function DemoVault({ fallbackSrc, fallbackAlt }: { fallbackSrc: string; fallbackAlt: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const labelsRef = useRef<Map<number, HTMLElement>>(new Map());
  const rafRef = useRef(0);
  const fitTimerRef = useRef(0);
  const pauseTimerRef = useRef(0);
  const resizeRef = useRef<ResizeObserver | null>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);

  const [colors, setColors] = useState<Record<string, string | null>>(
    () => Object.fromEntries(FOLDERS.map((f) => [f.id, f.color])),
  );
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Colour per note: its folder's, or the neutral grey. */
  const hexOf = useCallback(
    (index: number) => colors[NOTES[index].folder] ?? NEUTRAL,
    [colors],
  );

  /**
   * Frame the notes. The engine's own fit is built for vaults that dwarf the
   * viewport and leaves a two-dozen-node demo as a speck in the middle, so the
   * scale is measured rather than assumed: read how many pixels one simulation
   * unit currently covers, work out what it needs to be to fill the frame, and
   * move the camera there in one call.
   */
  /**
   * Frame the notes in the canvas.
   *
   * Done by measurement, not by the engine's own fit: `getPointPositions()`
   * reports the seeded layout rather than the settled one, and the scale
   * argument of the camera call is not an absolute zoom level. So this reads
   * where the points actually are, works out how many pixels one simulation
   * unit needs to cover, and nudges the camera there — then checks its work a
   * couple of times, because a still-cooling layout moves under the camera.
   */
  const fitToPoints = useCallback((duration: number, passes = 3) => {
    const pass = (dur: number, left: number) => {
      const graph = graphRef.current;
      const box = canvasRef.current;
      if (!graph || !box) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [, pos] of graph.getTrackedPointPositionsMap()) {
        if (!pos) continue;
        minX = Math.min(minX, pos[0]);
        maxX = Math.max(maxX, pos[0]);
        minY = Math.min(minY, pos[1]);
        maxY = Math.max(maxY, pos[1]);
      }
      if (!Number.isFinite(minX)) return;
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);

      // Pixels one simulation unit covers now, from the engine's projection.
      const [ax, ay] = graph.spaceToScreenPosition([minX, minY]);
      const [bx, by] = graph.spaceToScreenPosition([maxX, maxY]);
      const perUnit = Math.max(Math.abs(bx - ax) / spanX, Math.abs(by - ay) / spanY);
      if (!Number.isFinite(perUnit) || perUnit <= 0) return;

      // Labels hang to the right of their node, so width gets more slack.
      const want = Math.min((box.clientWidth * 0.72) / spanX, (box.clientHeight * 0.78) / spanY);
      const zoom = graph.getZoomLevel() * (want / perUnit);
      const centre = new Float32Array([(minX + maxX) / 2, (minY + maxY) / 2]);

      graph.setZoomTransformByPointPositions(centre, dur, zoom, 0, false);
      // The scale argument above is not an absolute zoom level; setting the
      // zoom explicitly afterwards is what actually lands it.
      window.setTimeout(() => graph.setZoomLevel(zoom, Math.min(200, dur)), dur + 40);

      // Check the work once the move has landed, and stop as soon as it is close.
      if (left > 1 && Math.abs(want / perUnit - 1) > 0.05) {
        window.clearTimeout(fitTimerRef.current);
        fitTimerRef.current = window.setTimeout(() => pass(220, left - 1), dur + 320);
      }
    };
    pass(duration, passes);
  }, []);

  // ── engine: created on first scroll into view, torn down on unmount ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        // Someone who asked for less motion gets the screenshot, not a
        // simulation — checked here rather than in the effect body so it is a
        // callback, not a synchronous setState during render.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setFailed(true);
          return;
        }
        try {
          const { Graph } = await import("@cosmos.gl/graph");
          if (cancelled || !canvasRef.current) return;

          const graph = new Graph(canvasRef.current, {
            backgroundColor: [0, 0, 0, 0],
            fitViewOnInit: false,
            rescalePositions: false,
            enableDrag: true,
            renderLinks: true,
            linkOpacity: 0.75,
            linkWidthScale: 1,
            pointSizeScale: 0.85,
            scalePointsOnZoom: false,
            hoveredPointCursor: "grab",
            renderHoveredPointRing: true,
            hoveredPointRingColor: rgba(ACCENT, 0.85),
            // Tuned for a two-dozen-node vault in a wide frame. The whole
            // layout is deliberately large in simulation units: the camera
            // will not zoom past 1x, so a small cloud can never be framed to
            // fill the canvas — it has to be big and zoomed out instead.
            simulationGravity: 0.06,
            simulationCenter: 0.35,
            simulationRepulsion: 6,
            simulationLinkSpring: 1,
            simulationLinkDistance: 190,
            simulationFriction: 0.82,
            simulationDecay: 1400,
            simulationCollision: 0.9,
            simulationCollisionRadius: 46,
            onPointMouseOver: (index: number) => setHovered(index),
            onPointMouseOut: () => setHovered(null),
          });

          // Seed a golden-angle disc — the most even start there is, so the
          // simulation settles into a readable shape fast.
          const n = NOTES.length;
          const positions = new Float32Array(n * 2);
          const golden = Math.PI * (3 - Math.sqrt(5));
          for (let i = 0; i < n; i++) {
            const r = 900 * Math.sqrt((i + 0.5) / n);
            const a = i * golden;
            positions[i * 2] = SPACE / 2 + r * Math.cos(a);
            positions[i * 2 + 1] = SPACE / 2 + r * Math.sin(a);
          }
          const links = new Float32Array(EDGES.length * 2);
          const linkColors = new Float32Array(EDGES.length * 4);
          EDGES.forEach(([s, t], i) => {
            links[i * 2] = s;
            links[i * 2 + 1] = t;
            linkColors.set(rgba("#6b6780", 0.75), i * 4);
          });

          graph.setPointPositions(positions, true);
          graph.setLinks(links);
          graph.setLinkColors(linkColors);
          graph.trackPointPositionsByIndices(NOTES.map((_, i) => i));
          graphRef.current = graph;
          setLive(true);

          // labels ride along in an overlay, the way the app draws them
          const overlay = document.createElement("div");
          overlay.className = "pointer-events-none absolute inset-0 overflow-hidden";
          canvasRef.current.appendChild(overlay);
          NOTES.forEach((note, i) => {
            const el = document.createElement("div");
            el.textContent = note.title;
            el.className = "nodum-demo-label";
            overlay.appendChild(el);
            labelsRef.current.set(i, el);
          });

          const tick = () => {
            const g = graphRef.current;
            const box = canvasRef.current;
            if (g && box) {
              const w = box.clientWidth;
              const h = box.clientHeight;
              for (const [i, pos] of g.getTrackedPointPositionsMap()) {
                const el = labelsRef.current.get(i);
                if (!el || !pos) continue;
                const [x, y] = g.spaceToScreenPosition([pos[0], pos[1]]);
                const off = x < -40 || x > w + 40 || y < -20 || y > h + 20;
                el.style.opacity = off ? "0" : "1";
                el.style.transform = `translate(${x.toFixed(1)}px, ${(y + 9).toFixed(1)}px) translateX(-50%)`;
              }
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
          graph.render(0.9);

          // Frame it once the layout stops moving. Fitting earlier looks right
          // for a second and then shrinks, because the centre force keeps
          // drawing the cloud in — so the settle fit is the one that counts,
          // and the simulation parks there instead of idling on the GPU.
          // Park the simulation first, then frame it. Fitting a moving layout
          // looks right for a moment and then drifts small, because the centre
          // force keeps drawing the cloud in under the camera.
          fitTimerRef.current = window.setTimeout(() => {
            graphRef.current?.pause();
            window.setTimeout(() => fitToPoints(700), 120);
          }, 5200);

          // Dragging wakes it: the held node pulls its neighbours, then the
          // whole thing settles and parks again.
          const host = canvasRef.current;
          const wake = () => {
            window.clearTimeout(pauseTimerRef.current);
            graphRef.current?.unpause();
            graphRef.current?.render(0.06);
          };
          const rest = () => {
            window.clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = window.setTimeout(() => graphRef.current?.pause(), 1600);
          };
          host.addEventListener("pointerdown", wake);
          host.addEventListener("pointerup", rest);
          pointerCleanupRef.current = () => {
            host.removeEventListener("pointerdown", wake);
            host.removeEventListener("pointerup", rest);
          };

          const ro = new ResizeObserver(() => {
            window.clearTimeout(fitTimerRef.current);
            fitTimerRef.current = window.setTimeout(() => fitToPoints(400), 250);
          });
          ro.observe(canvasRef.current);
          resizeRef.current = ro;
        } catch {
          if (!cancelled) setFailed(true);
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(host);

    return () => {
      cancelled = true;
      io.disconnect();
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(fitTimerRef.current);
      window.clearTimeout(pauseTimerRef.current);
      pointerCleanupRef.current?.();
      resizeRef.current?.disconnect();
      labelsRef.current.clear();
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [fitToPoints]);

  // ── paint: folder colours, plus whatever is hovered ──
  const paint = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const pointColors = new Float32Array(NOTES.length * 4);
    const sizes = new Float32Array(NOTES.length);
    const near = hovered === null ? null : new Set([hovered, ...ADJACENCY[hovered]]);
    NOTES.forEach((_, i) => {
      const dim = near !== null && !near.has(i);
      pointColors.set(rgba(i === hovered ? ACCENT : hexOf(i), dim ? 0.25 : 1), i * 4);
      sizes[i] = (6.5 + 2.6 * Math.sqrt(DEGREE[i])) * (i === hovered ? 1.6 : 1);
      const el = labelsRef.current.get(i);
      if (el) {
        el.style.color = i === hovered ? ACCENT : hexOf(i);
        el.style.opacity = dim ? "0.25" : "1";
      }
    });
    graph.setPointColors(pointColors);
    graph.setPointSizes(sizes);
    graph.render(undefined, 0);
  }, [hexOf, hovered]);

  useEffect(() => {
    if (live) paint();
  }, [live, paint]);

  if (failed) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--mk-line-strong)] bg-[var(--mk-ink-raised)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fallbackSrc} alt={fallbackAlt} className="block w-full" loading="lazy" />
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="mk-demo overflow-hidden rounded-2xl border border-[var(--mk-line-strong)] bg-[var(--mk-ink-raised)] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
    >
      <div className="grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {/* explorer — height-matched to the canvas, scrolling if it overflows */}
        <div className="max-h-[15rem] overflow-y-auto border-b border-[var(--mk-line)] p-3 md:max-h-[30rem] md:border-r md:border-b-0">
          <p className="mk-mono px-2 pt-1 pb-3 text-[0.65rem] tracking-[0.18em] text-[var(--mk-faint)]">
            EXPLORER
          </p>
          <ul className="space-y-0.5">
            {FOLDERS.map((folder) => (
              <li key={folder.id}>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <button
                    type="button"
                    className="mk-swatch"
                    aria-label={`Colour the ${folder.name} folder`}
                    aria-expanded={openPicker === folder.id}
                    onClick={() => setOpenPicker((id) => (id === folder.id ? null : folder.id))}
                    style={{ background: colors[folder.id] ?? "transparent" }}
                  />
                  <span
                    className="text-[0.8125rem] font-medium"
                    style={{ color: colors[folder.id] ?? "var(--mk-muted)" }}
                  >
                    {folder.name}
                  </span>
                </div>

                {openPicker === folder.id && (
                  <div className="mb-1 ml-8 flex flex-wrap items-center gap-1.5">
                    {SWATCHES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        aria-label={s.name}
                        className="mk-swatch mk-swatch--pick"
                        style={{ background: s.value }}
                        onClick={() => {
                          setColors((c) => ({ ...c, [folder.id]: s.value }));
                          setOpenPicker(null);
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      className="mk-mono px-1 text-[0.65rem] text-[var(--mk-faint)] hover:text-[var(--mk-paper)]"
                      onClick={() => {
                        setColors((c) => ({ ...c, [folder.id]: null }));
                        setOpenPicker(null);
                      }}
                    >
                      none
                    </button>
                  </div>
                )}

                <ul>
                  {NOTES.map((note, i) =>
                    note.folder === folder.id ? (
                      <li key={note.title}>
                        <button
                          type="button"
                          className={cn("mk-note-row", hovered === i && "is-on")}
                          style={{ color: colors[folder.id] ?? undefined }}
                          onMouseEnter={() => setHovered(i)}
                          onMouseLeave={() => setHovered(null)}
                          onFocus={() => setHovered(i)}
                          onBlur={() => setHovered(null)}
                        >
                          {note.title}
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              </li>
            ))}
          </ul>
        </div>

        {/* graph */}
        <div className="relative">
          <div ref={canvasRef} className="relative h-[22rem] w-full md:h-[30rem]" />
          <p className="mk-mono pointer-events-none absolute inset-x-0 bottom-3 text-center text-[0.65rem] text-[var(--mk-faint)]">
            {live ? "drag a node · hover a file · recolour a folder" : "waking the graph…"}
          </p>
        </div>
      </div>
    </div>
  );
}
