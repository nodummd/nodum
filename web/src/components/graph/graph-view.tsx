"use client";

/**
 * Knowledge graph — GPU force simulation via @cosmos.gl/graph (MIT).
 * Colors read from CSS variables at runtime so themes restyle the canvas;
 * node radius encodes degree; unresolved links render as ghost nodes and
 * clicking one creates the note (Obsidian semantics).
 */

import { Graph as CosmosGraph } from "@cosmos.gl/graph";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { Pause, Play, Settings2 } from "lucide-react";

import { linkApi, vaultApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";
import { GROUP_PALETTE, matchGroupHex, matchGroupIndex, type GraphGroup } from "@/lib/graph/groups";

const LABELS_SHOWN = 28;

/** Mobile: card hidden unless toggled; desktop: always visible. */
function cnControls(open: boolean, base: string): string {
  return `${open ? "block" : "hidden"} md:block ${base}`;
}

/** Shape stored under vaults.settings.graph (all keys optional). */
interface PersistedGraph {
  groups?: GraphGroup[];
  showGhosts?: boolean;
  showOrphans?: boolean;
  centerForce?: number;
  repelForce?: number;
  linkDistance?: number;
}

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
  const [controlsOpen, setControlsOpen] = useState(false);
  // Time travel: reveal the first p% of nodes in creation order (100 = now)
  const [timePercent, setTimePercent] = useState(100);
  const [playing, setPlaying] = useState(false);
  const queryClient = useQueryClient();

  // Settings persist per vault under settings.graph. Local edits are drafts
  // layered over the persisted value (draft ?? persisted ?? default) so async
  // load needs no state syncing; the compact side-panel never persists.
  const { data: vaults } = useQuery({
    queryKey: ["vaults"],
    queryFn: vaultApi.list,
    enabled: !compact,
  });
  const persisted = useMemo<PersistedGraph>(() => {
    const vault = vaults?.find((v) => v.id === vaultId);
    return (vault?.settings as { graph?: PersistedGraph } | undefined)?.graph ?? {};
  }, [vaults, vaultId]);

  const [ghostsDraft, setGhostsDraft] = useState<boolean | null>(null);
  const [orphansDraft, setOrphansDraft] = useState<boolean | null>(null);
  const [centerDraft, setCenterDraft] = useState<number | null>(null);
  const [repelDraft, setRepelDraft] = useState<number | null>(null);
  const [distDraft, setDistDraft] = useState<number | null>(null);
  const [groupsDraft, setGroupsDraft] = useState<GraphGroup[] | null>(null);

  const showGhosts = ghostsDraft ?? persisted.showGhosts ?? true;
  const showOrphans = orphansDraft ?? persisted.showOrphans ?? true;
  const centerForce = centerDraft ?? persisted.centerForce ?? 0.55;
  const repelForce = repelDraft ?? persisted.repelForce ?? 1.1;
  const linkDistance = distDraft ?? persisted.linkDistance ?? 12;
  const groups = useMemo(
    () => groupsDraft ?? persisted.groups ?? [],
    [groupsDraft, persisted.groups],
  );

  // Slider/group values update instantly for the UI; the WebGL graph only
  // rebuilds against the debounced copies (300ms idle) — dragging a slider or
  // typing a group query would otherwise tear down the simulation per tick.
  const [applied, setApplied] = useState({ centerForce: 0.55, repelForce: 1.1, linkDistance: 12 });
  const [appliedGroups, setAppliedGroups] = useState<GraphGroup[]>([]);
  const groupsJson = JSON.stringify(groups);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setTimePercent((p) => {
        if (p >= 100) {
          setPlaying(false);
          return 100;
        }
        return Math.min(100, p + 4);
      });
    }, 200);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied({ centerForce, repelForce, linkDistance });
    }, 300);
    return () => clearTimeout(timer);
  }, [centerForce, repelForce, linkDistance]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedGroups(JSON.parse(groupsJson) as GraphGroup[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [groupsJson]);

  // Debounced persistence — only after the user actually changed something.
  const touched =
    ghostsDraft !== null ||
    orphansDraft !== null ||
    centerDraft !== null ||
    repelDraft !== null ||
    distDraft !== null ||
    groupsDraft !== null;
  const settingsJson = JSON.stringify({
    groups,
    showGhosts,
    showOrphans,
    centerForce,
    repelForce,
    linkDistance,
  } satisfies PersistedGraph);
  const persistSettings = useMutation({
    mutationFn: (graph: PersistedGraph) => vaultApi.update(vaultId, { settings: { graph } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["vaults"], (old: Vault[] | undefined) =>
        old?.map((v) => (v.id === updated.id ? updated : v)),
      );
    },
  });
  const persistMutate = persistSettings.mutate;
  useEffect(() => {
    if (compact || !touched) return;
    const timer = setTimeout(() => {
      persistMutate(JSON.parse(settingsJson) as PersistedGraph);
    }, 800);
    return () => clearTimeout(timer);
  }, [settingsJson, compact, touched, persistMutate]);

  const { data } = useQuery({
    queryKey: centerNoteId
      ? ["local-graph", vaultId, centerNoteId, depth]
      : ["graph", vaultId],
    queryFn: () =>
      centerNoteId ? linkApi.localGraph(vaultId, centerNoteId, depth) : linkApi.graph(vaultId),
  });

  /** Filtered view of the payload (ghosts/orphans toggles + time travel). */
  const filtered = useMemo(() => {
    if (!data) return null;
    // creation-ordered reveal set (ghosts count as newest)
    let revealed: Set<number> | null = null;
    if (timePercent < 100) {
      const order = data.nodes
        .map((node, i) => ({ i, at: node.created_at ?? "9999" }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i));
      const count = Math.max(1, Math.ceil((timePercent / 100) * order.length));
      revealed = new Set(order.slice(0, count).map((x) => x.i));
    }
    const keep: number[] = [];
    const remap = new Map<number, number>();
    data.nodes.forEach((node, i) => {
      if (revealed && !revealed.has(i)) return;
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
  }, [data, showGhosts, showOrphans, timePercent]);

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
    // Pre-resolve each group's color once (canvas probe per group, not per node)
    const groupRgba = appliedGroups.map((g) => toRgba(g.color, 1));
    // cosmos space runs [0, spaceSize]; seed points around its center
    const SPACE = 4096;
    const spread = Math.max(200, Math.sqrt(n) * 60);
    for (let i = 0; i < n; i++) {
      const node = filtered.nodes[i];
      positions[i * 2] = SPACE / 2 + (Math.random() - 0.5) * spread;
      positions[i * 2 + 1] = SPACE / 2 + (Math.random() - 0.5) * spread;
      const isCenter = centerNoteId && node.id === centerNoteId;
      // Precedence: center focus > ghost > group color (first match) > default
      const gi = node.unresolved ? -1 : matchGroupIndex(node, appliedGroups);
      const c = isCenter
        ? focusColor
        : node.unresolved
          ? ghostColor
          : gi >= 0
            ? groupRgba[gi]
            : nodeColor;
      colors.set(c, i * 4);
      // Obsidian-ish radius: grows with sqrt(degree), clamped
      sizes[i] = Math.min(6 + 3 * Math.sqrt(node.degree), 26) * (isCenter ? 1.3 : 1);
    }
    const links = new Float32Array(filtered.edges.length * 2);
    filtered.edges.forEach(([s, t], i) => {
      links[i * 2] = s;
      links[i * 2 + 1] = t;
    });

    // Hover dim (research spec): fade non-neighbors to ~0.2 alpha, eased
    const adjacency: Set<number>[] = filtered.nodes.map(() => new Set<number>());
    filtered.edges.forEach(([s, t]) => {
      adjacency[s].add(t);
      adjacency[t].add(s);
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
        const target = colors.slice();
        for (let i = 0; i < n; i++) {
          if (i === index || adjacency[index].has(i)) continue;
          target[i * 4 + 3] = colors[i * 4 + 3] * 0.2;
        }
        animateColors(target);
        const dimmedLinks = baseLinkColors.slice();
        filtered.edges.forEach(([s, t], i) => {
          if (s !== index && t !== index) dimmedLinks[i * 4 + 3] *= 0.15;
        });
        graphRef.current?.setLinkColors(dimmedLinks);
      },
      onPointMouseOut: () => {
        setHovered(null);
        animateColors(colors.slice());
        graphRef.current?.setLinkColors(baseLinkColors.slice());
      },
    });

    // Eased color transition (easeOutQuad over ~160ms) toward a target array
    let dimRaf = 0;
    let currentColors = colors.slice();
    function animateColors(target: Float32Array): void {
      cancelAnimationFrame(dimRaf);
      const start = currentColors.slice();
      const t0 = performance.now();
      const DURATION = 160;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / DURATION);
        const eased = t * (2 - t);
        const mixed = new Float32Array(start.length);
        for (let i = 0; i < mixed.length; i++) mixed[i] = start[i] + (target[i] - start[i]) * eased;
        graphRef.current?.setPointColors(mixed);
        currentColors = mixed;
        if (t < 1) dimRaf = requestAnimationFrame(step);
      };
      dimRaf = requestAnimationFrame(step);
    }

    graph.setPointPositions(positions);
    graph.setPointColors(colors);
    graph.setPointSizes(sizes);
    graph.setLinks(links);
    const baseLinkColors = new Float32Array(filtered.edges.length * 4);
    for (let i = 0; i < filtered.edges.length; i++) baseLinkColors.set(linkColor, i * 4);
    graph.setLinkColors(baseLinkColors);
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
      // Grouped nodes carry their group color into the label too
      if (!filtered.nodes[i].unresolved) {
        const hex = matchGroupHex(filtered.nodes[i], appliedGroups);
        if (hex) el.style.color = hex;
      }
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
      cancelAnimationFrame(dimRaf);
      overlay.remove();
      graph.destroy();
      graphRef.current = null;
    };
    // Re-create when data, physics sliders, or groups change (re-init is cheap)
  }, [filtered, centerNoteId, applied, appliedGroups, onOpenNote, onCreateNote]);

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

      {/* Controls — Obsidian's graph settings card (behind a gear on mobile) */}
      {!compact && (
        <button
          type="button"
          aria-label="Graph settings"
          onClick={() => setControlsOpen((v) => !v)}
          className="absolute right-3 bottom-16 z-10 flex size-11 items-center justify-center rounded-full border border-ob-border bg-ob-sidebar/95 text-ob-muted shadow-lg backdrop-blur md:hidden"
        >
          <Settings2 className="size-5" strokeWidth={1.75} />
        </button>
      )}
      {!compact && (
      <div
        className={cnControls(
          controlsOpen,
          "absolute top-3 right-3 z-10 w-52 rounded-lg border border-ob-border bg-ob-sidebar/95 p-3 text-[12px] backdrop-blur",
        )}
      >
        <p className="pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Filters</p>
        <label className="flex items-center justify-between py-0.5 text-ob-muted">
          Existing files only
          <input
            type="checkbox"
            checked={!showGhosts}
            onChange={(e) => setGhostsDraft(!e.target.checked)}
            className="accent-[var(--ob-interactive-accent)]"
          />
        </label>
        <label className="flex items-center justify-between py-0.5 text-ob-muted">
          Orphans
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setOrphansDraft(e.target.checked)}
            className="accent-[var(--ob-interactive-accent)]"
          />
        </label>

        <p className="pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Forces</p>
        <ForceSlider label="Center force" min={0} max={1} step={0.05} value={centerForce} onChange={setCenterDraft} />
        <ForceSlider label="Repel force" min={0.1} max={3} step={0.1} value={repelForce} onChange={setRepelDraft} />
        <ForceSlider label="Link distance" min={4} max={40} step={1} value={linkDistance} onChange={setDistDraft} />

        <p className="pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Groups</p>
        {groups.map((g, i) => (
          <div key={i} className="flex items-center gap-1.5 py-0.5">
            <input
              type="color"
              value={g.color}
              aria-label={`Group ${i + 1} color`}
              onChange={(e) =>
                setGroupsDraft(groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
              }
              className="h-5 w-6 shrink-0 cursor-pointer rounded border border-ob-border bg-transparent p-0"
            />
            <input
              value={g.query}
              aria-label={`Group ${i + 1} query`}
              placeholder="path: tag:# file: text"
              onChange={(e) =>
                setGroupsDraft(groups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)))
              }
              className="h-6 min-w-0 flex-1 rounded border border-ob-border bg-ob-bg px-1.5 text-[12px] text-ob-text outline-none placeholder:text-ob-faint"
            />
            <button
              type="button"
              aria-label={`Remove group ${i + 1}`}
              onClick={() => setGroupsDraft(groups.filter((_, j) => j !== i))}
              className="shrink-0 text-ob-faint hover:text-ob-text"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setGroupsDraft([
              ...groups,
              { query: "", color: GROUP_PALETTE[groups.length % GROUP_PALETTE.length] },
            ])
          }
          className="mt-1 w-full rounded border border-dashed border-ob-border py-0.5 text-[11px] text-ob-faint hover:text-ob-text"
        >
          + Add group
        </button>

        <p className="pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Time travel</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? "Pause replay" : "Replay vault growth"}
            onClick={() => {
              if (!playing && timePercent >= 100) setTimePercent(0);
              setPlaying((v) => !v);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded text-ob-muted hover:bg-ob-hover hover:text-ob-text"
          >
            {playing ? <Pause className="size-3.5" strokeWidth={2} /> : <Play className="size-3.5" strokeWidth={2} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={timePercent}
            aria-label="Time travel"
            onChange={(e) => {
              setPlaying(false);
              setTimePercent(Number(e.target.value));
            }}
            className="w-full accent-[var(--ob-interactive-accent)]"
          />
        </div>

        {data && (
          <p className="pt-2 text-[11px] text-ob-faint">
            {filtered?.nodes.length ?? 0} nodes · {filtered?.edges.length ?? 0} links
            {data.truncated ? " · capped" : ""}
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
