"use client";

/**
 * Knowledge graph — GPU force simulation via @cosmos.gl/graph (MIT).
 * Colors read from CSS variables at runtime so themes restyle the canvas;
 * node radius encodes degree; unresolved links render as ghost nodes and
 * clicking one creates the note (Obsidian semantics).
 */

import { Graph as CosmosGraph } from "@cosmos.gl/graph";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { linkApi } from "@/lib/api/endpoints";

const LABELS_SHOWN = 28;

interface GraphViewProps {
  vaultId: string;
  /** When set, renders the local graph around this note. */
  centerNoteId?: string;
  depth?: number;
  /** Side-panel mode: hides the filters/forces card. */
  compact?: boolean;
  onOpenNote: (noteId: string, title: string) => void;
  onCreateNote: (title: string) => void;
}

function cssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Parse "#rrggbb" / "hsl(...)" into normalized rgba floats via a canvas probe. */
function toRgba(color: string, alpha: number): [number, number, number, number] {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return [0.7, 0.7, 0.7, alpha];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, alpha];
}

export function GraphView({ vaultId, centerNoteId, depth = 1, compact = false, onOpenNote, onCreateNote }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const rafRef = useRef<number>(0);
  const [hovered, setHovered] = useState<{ title: string; x: number; y: number } | null>(null);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  // Slider values update instantly for the UI; the WebGL graph only rebuilds
  // against the debounced copies (300ms idle) — dragging a slider would
  // otherwise tear down and recreate the simulation on every tick.
  const [centerForce, setCenterForce] = useState(0.55);
  const [repelForce, setRepelForce] = useState(1.1);
  const [linkDistance, setLinkDistance] = useState(12);
  const [applied, setApplied] = useState({ centerForce: 0.55, repelForce: 1.1, linkDistance: 12 });

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied({ centerForce, repelForce, linkDistance });
    }, 300);
    return () => clearTimeout(timer);
  }, [centerForce, repelForce, linkDistance]);

  const { data } = useQuery({
    queryKey: centerNoteId
      ? ["local-graph", vaultId, centerNoteId, depth]
      : ["graph", vaultId],
    queryFn: () =>
      centerNoteId ? linkApi.localGraph(vaultId, centerNoteId, depth) : linkApi.graph(vaultId),
  });

  /** Filtered view of the payload (ghosts/orphans toggles). */
  const filtered = useMemo(() => {
    if (!data) return null;
    const keep: number[] = [];
    const remap = new Map<number, number>();
    data.nodes.forEach((node, i) => {
      if (!showGhosts && node.unresolved) return;
      if (!showOrphans && node.degree === 0) return;
      remap.set(i, keep.length);
      keep.push(i);
    });
    const nodes = keep.map((i) => data.nodes[i]);
    const edges = data.edges
      .filter(([s, t]) => remap.has(s) && remap.has(t))
      .map(([s, t]) => [remap.get(s) as number, remap.get(t) as number] as [number, number]);
    return { nodes, edges };
  }, [data, showGhosts, showOrphans]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !filtered) return;

    const accent = cssColor("--ob-interactive-accent", "hsl(254, 80%, 68%)");
    const nodeColor = toRgba(cssColor("--ob-text-muted", "#b3b3b3"), 1);
    const ghostColor = toRgba(cssColor("--ob-text-faint", "#666666"), 0.45);
    const focusColor = toRgba(accent, 1);
    const linkColor = toRgba(cssColor("--ob-text-faint", "#666666"), 0.55);

    const n = filtered.nodes.length;
    const positions = new Float32Array(n * 2);
    const colors = new Float32Array(n * 4);
    const sizes = new Float32Array(n);
    // cosmos space runs [0, spaceSize]; seed points around its center
    const SPACE = 4096;
    const spread = Math.max(200, Math.sqrt(n) * 60);
    for (let i = 0; i < n; i++) {
      const node = filtered.nodes[i];
      positions[i * 2] = SPACE / 2 + (Math.random() - 0.5) * spread;
      positions[i * 2 + 1] = SPACE / 2 + (Math.random() - 0.5) * spread;
      const isCenter = centerNoteId && node.id === centerNoteId;
      const c = isCenter ? focusColor : node.unresolved ? ghostColor : nodeColor;
      colors.set(c, i * 4);
      // Obsidian-ish radius: grows with sqrt(degree), clamped
      sizes[i] = Math.min(6 + 3 * Math.sqrt(node.degree), 26) * (isCenter ? 1.3 : 1);
    }
    const links = new Float32Array(filtered.edges.length * 2);
    filtered.edges.forEach(([s, t], i) => {
      links[i * 2] = s;
      links[i * 2 + 1] = t;
    });

    const graph = new CosmosGraph(container, {
      backgroundColor: [0, 0, 0, 0],
      enableDrag: true,
      renderLinks: true,
      linkOpacity: 0.7,
      linkWidthScale: 1,
      pointSizeScale: 1,
      hoveredPointCursor: "pointer",
      hoveredPointRingColor: toRgba(accent, 0.9),
      simulationGravity: 0.1,
      simulationCenter: applied.centerForce,
      simulationRepulsion: applied.repelForce,
      simulationRepulsionTheta: 0.9,
      simulationLinkSpring: 1.1,
      simulationLinkDistance: applied.linkDistance,
      simulationFriction: 0.85,
      simulationDecay: 4000,
      simulationCollision: 0.5,
      onClick: (index) => {
        if (index === undefined) return;
        const node = filtered.nodes[index];
        if (!node) return;
        if (node.unresolved) onCreateNote(node.title);
        else onOpenNote(node.id, node.title);
      },
      onPointMouseOver: (index, _pos, event) => {
        const node = filtered.nodes[index];
        if (node && event instanceof MouseEvent) {
          setHovered({ title: node.title, x: event.offsetX, y: event.offsetY });
        }
      },
      onPointMouseOut: () => setHovered(null),
    });

    graph.setPointPositions(positions);
    graph.setPointColors(colors);
    graph.setPointSizes(sizes);
    graph.setLinks(links);
    const linkColors = new Float32Array(filtered.edges.length * 4);
    for (let i = 0; i < filtered.edges.length; i++) linkColors.set(linkColor, i * 4);
    graph.setLinkColors(linkColors);
    graph.render(0.9);
    graph.fitView(300);
    graphRef.current = graph;

    // Re-frame once the simulation has mostly settled
    const fitTimer = setTimeout(() => graph.fitView(400), 1500);

    // ── HTML label overlay for the top-degree nodes ──────────────────────
    const labelIndices = filtered.nodes
      .map((node, i) => ({ i, degree: node.degree }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, LABELS_SHOWN)
      .map((x) => x.i);
    graph.trackPointPositionsByIndices(labelIndices);

    const overlay = document.createElement("div");
    overlay.className = "pointer-events-none absolute inset-0 overflow-hidden";
    container.appendChild(overlay);
    const labelEls = new Map<number, HTMLDivElement>();
    for (const i of labelIndices) {
      const el = document.createElement("div");
      el.textContent = filtered.nodes[i].title;
      el.className = "nodum-graph-label";
      overlay.appendChild(el);
      labelEls.set(i, el);
    }

    const tick = () => {
      const tracked = graph.getTrackedPointPositionsMap();
      const zoom = graph.getZoomLevel();
      const opacity = Math.max(0, Math.min(1, Math.log2(zoom) + 1));
      for (const [i, pos] of tracked) {
        const el = labelEls.get(i);
        if (!el || !pos) continue;
        const [x, y] = graph.spaceToScreenPosition([pos[0], pos[1]]);
        el.style.transform = `translate(${String(Math.round(x))}px, ${String(Math.round(y + 8))}px) translateX(-50%)`;
        el.style.opacity = String(opacity);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      clearTimeout(fitTimer);
      cancelAnimationFrame(rafRef.current);
      overlay.remove();
      graph.destroy();
      graphRef.current = null;
    };
    // Re-create when data or physics sliders change (cosmos re-init is cheap)
  }, [filtered, centerNoteId, applied, onOpenNote, onCreateNote]);

  return (
    <div className="relative h-full w-full bg-ob-bg">
      <div ref={containerRef} className="absolute inset-0" />

      {hovered && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-ob-border bg-[var(--ob-color-base-25)] px-2 py-1 text-[12px] text-ob-text shadow-lg"
          style={{ left: hovered.x + 12, top: hovered.y + 12 }}
        >
          {hovered.title}
        </div>
      )}

      {/* Controls — Obsidian's graph settings card */}
      {!compact && (
      <div className="absolute top-3 right-3 z-10 w-52 rounded-lg border border-ob-border bg-ob-sidebar/95 p-3 text-[12px] backdrop-blur">
        <p className="pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Filters</p>
        <label className="flex items-center justify-between py-0.5 text-ob-muted">
          Existing files only
          <input
            type="checkbox"
            checked={!showGhosts}
            onChange={(e) => setShowGhosts(!e.target.checked)}
            className="accent-[var(--ob-interactive-accent)]"
          />
        </label>
        <label className="flex items-center justify-between py-0.5 text-ob-muted">
          Orphans
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
            className="accent-[var(--ob-interactive-accent)]"
          />
        </label>

        <p className="pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Forces</p>
        <ForceSlider label="Center force" min={0} max={1} step={0.05} value={centerForce} onChange={setCenterForce} />
        <ForceSlider label="Repel force" min={0.1} max={3} step={0.1} value={repelForce} onChange={setRepelForce} />
        <ForceSlider label="Link distance" min={4} max={40} step={1} value={linkDistance} onChange={setLinkDistance} />

        {data && (
          <p className="pt-2 text-[11px] text-ob-faint">
            {filtered?.nodes.length ?? 0} nodes · {filtered?.edges.length ?? 0} links
          </p>
        )}
      </div>
      )}
    </div>
  );
}

function ForceSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block py-0.5 text-ob-muted">
      <span className="flex justify-between">
        {label}
        <span className="text-ob-faint">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--ob-interactive-accent)]"
      />
    </label>
  );
}
