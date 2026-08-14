"use client";

/**
 * Knowledge graph — GPU force simulation via @cosmos.gl/graph (MIT).
 * Colors read from CSS variables at runtime so themes restyle the canvas;
 * node radius encodes degree; unresolved links render as ghost nodes and
 * clicking one creates the note (Obsidian semantics).
 */

import { Graph as CosmosGraph, TransitionEasing } from "@cosmos.gl/graph";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { Pause, Play, RotateCcw, Settings2 } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { linkApi, vaultApi } from "@/lib/api/endpoints";
import type { GraphNode, Vault } from "@/lib/api/types";
import { GROUP_PALETTE, matchGroupHex, matchGroupIndex, matchesQuery, type GraphGroup } from "@/lib/graph/groups";

// Label EVERY node (Obsidian shows them all, fading by zoom). The render loop
// culls off-screen labels; the cap only protects very large vaults.
const LABEL_CAP = 1200;

// Layouts survive graph close/reopen within the session (Obsidian keeps its
// layout too — we go further and keep it across tab switches).
const positionStores = new Map<string, Map<string, [number, number]>>();
function getPositionStore(key: string): Map<string, [number, number]> {
  let store = positionStores.get(key);
  if (!store) {
    store = new Map();
    positionStores.set(key, store);
  }
  return store;
}
// Viewport-center space point + zoom per view — restores the exact camera.
const cameraStores = new Map<string, [number, number, number]>();

/** Shape stored under vaults.settings.graph (all keys optional). */
interface PersistedGraph {
  groups?: GraphGroup[];
  showGhosts?: boolean;
  showOrphans?: boolean;
  centerForce?: number;
  repelForce?: number;
  linkDistance?: number;
  linkForce?: number;
  arrows?: boolean;
  nodeSize?: number;
  linkThickness?: number;
}

/** Single source of truth for graph defaults (used by the fallback chain,
 *  the applied-forces seed, and the reset-to-defaults button). */
const GRAPH_DEFAULTS: Required<PersistedGraph> = {
  groups: [],
  showGhosts: true,
  showOrphans: true,
  centerForce: 0.2,
  repelForce: 4.2,
  linkDistance: 42,
  linkForce: 1,
  arrows: false,
  nodeSize: 1,
  linkThickness: 1,
};

interface GraphViewProps {
  vaultId: string;
  /** When set, renders the local graph around this note. */
  centerNoteId?: string;
  depth?: number;
  /** Side-panel mode: hides the filters/forces card. */
  compact?: boolean;
  /** Note to accent-highlight as "selected" (the one open beside the graph). */
  focusNoteId?: string | null;
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

export function GraphView({ vaultId, centerNoteId, depth = 1, compact = false, focusNoteId = null, onOpenNote, onCreateNote }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const rafRef = useRef<number>(0);
  const [hovered, setHovered] = useState<{ title: string; x: number; y: number } | null>(null);
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
  const [linkForceDraft, setLinkForceDraft] = useState<number | null>(null);
  const [arrowsDraft, setArrowsDraft] = useState<boolean | null>(null);
  const [nodeSizeDraft, setNodeSizeDraft] = useState<number | null>(null);
  const [thicknessDraft, setThicknessDraft] = useState<number | null>(null);
  // graph search is session-only (matches Obsidian's transient filter box)
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [groupsDraft, setGroupsDraft] = useState<GraphGroup[] | null>(null);

  const showGhosts = ghostsDraft ?? persisted.showGhosts ?? GRAPH_DEFAULTS.showGhosts;
  const showOrphans = orphansDraft ?? persisted.showOrphans ?? GRAPH_DEFAULTS.showOrphans;
  const centerForce = centerDraft ?? persisted.centerForce ?? GRAPH_DEFAULTS.centerForce;
  const repelForce = repelDraft ?? persisted.repelForce ?? GRAPH_DEFAULTS.repelForce;
  const linkDistance = distDraft ?? persisted.linkDistance ?? GRAPH_DEFAULTS.linkDistance;
  const linkForce = linkForceDraft ?? persisted.linkForce ?? GRAPH_DEFAULTS.linkForce;
  const arrows = arrowsDraft ?? persisted.arrows ?? GRAPH_DEFAULTS.arrows;
  const nodeSize = nodeSizeDraft ?? persisted.nodeSize ?? GRAPH_DEFAULTS.nodeSize;
  const linkThickness = thicknessDraft ?? persisted.linkThickness ?? GRAPH_DEFAULTS.linkThickness;
  const groups = useMemo(
    () => groupsDraft ?? persisted.groups ?? GRAPH_DEFAULTS.groups,
    [groupsDraft, persisted.groups],
  );

  // One-click restore of every filter/display/force/group to the defaults.
  // Setting drafts (not null) marks `touched`, so the persist + apply effects
  // write and re-render the defaults automatically.
  const resetToDefaults = () => {
    setGhostsDraft(GRAPH_DEFAULTS.showGhosts);
    setOrphansDraft(GRAPH_DEFAULTS.showOrphans);
    setCenterDraft(GRAPH_DEFAULTS.centerForce);
    setRepelDraft(GRAPH_DEFAULTS.repelForce);
    setDistDraft(GRAPH_DEFAULTS.linkDistance);
    setLinkForceDraft(GRAPH_DEFAULTS.linkForce);
    setArrowsDraft(GRAPH_DEFAULTS.arrows);
    setNodeSizeDraft(GRAPH_DEFAULTS.nodeSize);
    setThicknessDraft(GRAPH_DEFAULTS.linkThickness);
    // Resetting the *view* must not delete curated colour groups — they're
    // content, not a view tweak. (Remove groups individually to clear them.)
    setSearchQuery("");
    setTimePercent(100);
    setPlaying(false);
  };

  // Slider/group values update instantly for the UI; the WebGL graph only
  // rebuilds against the debounced copies (300ms idle) — dragging a slider or
  // typing a group query would otherwise tear down the simulation per tick.
  const [applied, setApplied] = useState({
    centerForce: persisted.centerForce ?? GRAPH_DEFAULTS.centerForce,
    repelForce: persisted.repelForce ?? GRAPH_DEFAULTS.repelForce,
    linkDistance: persisted.linkDistance ?? GRAPH_DEFAULTS.linkDistance,
    linkForce: persisted.linkForce ?? GRAPH_DEFAULTS.linkForce,
  });
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
      setApplied({ centerForce, repelForce, linkDistance, linkForce });
    }, 300);
    return () => clearTimeout(timer);
  }, [centerForce, repelForce, linkDistance, linkForce]);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedGroups((prev) =>
        JSON.stringify(prev) === groupsJson ? prev : (JSON.parse(groupsJson) as GraphGroup[]),
      );
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
    linkForceDraft !== null ||
    arrowsDraft !== null ||
    nodeSizeDraft !== null ||
    thicknessDraft !== null ||
    groupsDraft !== null;
  const settingsJson = JSON.stringify({
    groups,
    showGhosts,
    showOrphans,
    centerForce,
    repelForce,
    linkDistance,
    linkForce,
    arrows,
    nodeSize,
    linkThickness,
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
    // Never persist before the vault's own settings have loaded — writing a
    // default-filled snapshot mid-load would clobber persisted groups/forces.
    if (compact || !touched || !vaults) return;
    const timer = setTimeout(() => {
      // Merge ONLY the keys the user actually changed over the persisted
      // settings. A full snapshot would clobber untouched keys — e.g. wipe
      // colour groups when a force slider moved, or the reverse.
      const patch: PersistedGraph = { ...persisted };
      if (ghostsDraft !== null) patch.showGhosts = showGhosts;
      if (orphansDraft !== null) patch.showOrphans = showOrphans;
      if (centerDraft !== null) patch.centerForce = centerForce;
      if (repelDraft !== null) patch.repelForce = repelForce;
      if (distDraft !== null) patch.linkDistance = linkDistance;
      if (linkForceDraft !== null) patch.linkForce = linkForce;
      if (arrowsDraft !== null) patch.arrows = arrows;
      if (nodeSizeDraft !== null) patch.nodeSize = nodeSize;
      if (thicknessDraft !== null) patch.linkThickness = linkThickness;
      if (groupsDraft !== null) patch.groups = groups;
      persistMutate(patch);
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsJson, compact, touched, persistMutate, vaults, persisted]);

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
      if (!matchesQuery(node, appliedSearch)) return;
      remap.set(i, keep.length);
      keep.push(i);
    });
    const nodes = keep.map((i) => data.nodes[i]);
    const edges = data.edges
      .filter(([s, t]) => remap.has(s) && remap.has(t))
      .map(([s, t]) => [remap.get(s) as number, remap.get(t) as number] as [number, number]);
    return { nodes, edges };
  }, [data, showGhosts, showOrphans, timePercent, appliedSearch]);

  // ── Incremental engine (Obsidian-study parity: never re-randomize) ────────
  // Positions survive data changes, filter/group tweaks, AND unmount/remount
  // (module-level store) — creating a note while the graph is open inserts
  // the new node beside its linked neighbors; nothing else jumps.
  const nodesRef = useRef<GraphNode[]>([]);
  const adjacencyRef = useRef<Set<number>[]>([]);
  const edgesRef = useRef<[number, number][]>([]);
  const colorsRef = useRef<Float32Array>(new Float32Array(0));
  const baseLinkColorsRef = useRef<Float32Array>(new Float32Array(0));
  // Base (un-focused) node colors, the accent used for the selected node, and
  // the previously-focused id — drives the sticky "selected note" highlight
  // without rebuilding the whole layout on every selection.
  const groupColorsRef = useRef<Float32Array>(new Float32Array(0));
  const groupSizesRef = useRef<Float32Array>(new Float32Array(0));
  const focusColorRef = useRef<[number, number, number, number]>([1, 1, 1, 1]);
  const prevFocusRef = useRef<string | null>(null);
  const prevIdsRef = useRef<string[]>([]);
  const didFitRef = useRef(false);
  // Set on a fresh (non-restored) first build; the sim-end handler / pause
  // fallback fits the camera to the settled layout exactly once.
  const fitOnSettleRef = useRef(false);
  const labelRef = useRef<{ overlay: HTMLDivElement; els: Map<number, HTMLDivElement> } | null>(null);
  const dimRafRef = useRef(0);
  const enterRafRef = useRef(0);
  const currentColorsRef = useRef<Float32Array>(new Float32Array(0));
  // camera rect tracked every frame — the container is already detached by
  // cleanup time, so an unmount-time read would see a zero-size viewport
  const cameraRef = useRef<[number, number, number] | null>(null);
  // frames rendered since the last data application — harvesting before the
  // first frame reads back unflushed GPU buffers (observed under StrictMode)
  const framesSinceApplyRef = useRef(0);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeKey = `${vaultId}:${centerNoteId ?? "global"}:${String(depth)}`;

  /** Eased color transition toward a target array (hover dim). */
  const animateColors = (target: Float32Array) => {
    cancelAnimationFrame(dimRafRef.current);
    const start = currentColorsRef.current.slice();
    if (start.length !== target.length) {
      graphRef.current?.setPointColors(target);
      currentColorsRef.current = target;
      return;
    }
    const t0 = performance.now();
    const DURATION = 160;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION);
      const eased = t * (2 - t);
      const mixed = new Float32Array(start.length);
      for (let i = 0; i < mixed.length; i++) mixed[i] = start[i] + (target[i] - start[i]) * eased;
      graphRef.current?.setPointColors(mixed);
      currentColorsRef.current = mixed;
      if (t < 1) dimRafRef.current = requestAnimationFrame(step);
    };
    dimRafRef.current = requestAnimationFrame(step);
  };

  /** Fade + scale newly-added nodes (and their links) in over ~320ms so a
   *  created note pops in beside its neighbors instead of appearing at once. */
  const runEnterAnimation = (
    addedPoints: number[],
    addedLinks: number[],
    targetColors: Float32Array,
    targetSizes: Float32Array,
    targetLinkColors: Float32Array,
  ) => {
    cancelAnimationFrame(enterRafRef.current);
    if (addedPoints.length === 0 && addedLinks.length === 0) return;
    const colors = targetColors.slice();
    const sizes = targetSizes.slice();
    const linkColors = targetLinkColors.slice();
    const t0 = performance.now();
    const DURATION = 320;
    const step = (now: number) => {
      const graph = graphRef.current;
      if (!graph) return;
      const t = Math.min(1, (now - t0) / DURATION);
      const eased = t * (2 - t); // ease-out
      for (const i of addedPoints) {
        sizes[i] = targetSizes[i] * eased;
        colors[i * 4 + 3] = targetColors[i * 4 + 3] * eased;
      }
      for (const i of addedLinks) linkColors[i * 4 + 3] = targetLinkColors[i * 4 + 3] * eased;
      graph.setPointSizes(sizes);
      graph.setPointColors(colors);
      graph.setLinkColors(linkColors);
      graph.render(0);
      if (t < 1) enterRafRef.current = requestAnimationFrame(step);
    };
    enterRafRef.current = requestAnimationFrame(step);
  };

  /** Copy the live layout + camera into the per-view stores. */
  const harvestPositions = () => {
    const graph = graphRef.current;
    const ids = prevIdsRef.current;
    if (!graph || ids.length === 0) return;
    // never harvest an un-rendered application — stale store beats garbage
    if (framesSinceApplyRef.current === 0) return;
    const flat = graph.getPointPositions();
    if (!flat || flat.length < ids.length * 2) return;
    const store = getPositionStore(storeKey);
    for (let i = 0; i < ids.length; i++) {
      store.set(ids[i], [flat[i * 2], flat[i * 2 + 1]]);
    }
    if (cameraRef.current) {
      cameraStores.set(storeKey, cameraRef.current);
    }
  };

  // Effect 1 — engine lifecycle: one CosmosGraph per mounted view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const accent = cssColor("--ob-interactive-accent", "hsl(254, 80%, 68%)");
    const graph = new CosmosGraph(container, {
      backgroundColor: [0, 0, 0, 0],
      fitViewOnInit: false,
      rescalePositions: false,
      enableDrag: true,
      renderLinks: true,
      linkOpacity: 0.75,
      linkWidthScale: 1,
      pointSizeScale: 1,
      // Nodes keep a constant screen size across zoom (no ballooning on zoom-in);
      // zooming just spreads them apart, which reads clean like Obsidian.
      scalePointsOnZoom: false,
      hoveredPointCursor: "pointer",
      hoveredPointRingColor: toRgba(accent, 0.9),
      renderHoveredPointRing: true,
      transitionDuration: 350,
      transitionEasing: TransitionEasing.QuadInOut,
      // Forces tuned for an Obsidian-like open, non-overlapping layout: a
      // longer link rest length and stronger repulsion spread clusters apart,
      // real collision stops nodes stacking, a gentle centre pull keeps
      // disconnected islands from drifting off-screen.
      simulationGravity: 0.05,
      simulationCenter: GRAPH_DEFAULTS.centerForce,
      simulationRepulsion: GRAPH_DEFAULTS.repelForce,
      simulationLinkSpring: GRAPH_DEFAULTS.linkForce,
      simulationLinkDistance: GRAPH_DEFAULTS.linkDistance,
      simulationFriction: 0.82,
      simulationDecay: 3000,
      // Collision radius derives from each node's own size so nodes never stack
      // while the layout stays airy.
      simulationCollision: 1,
      // Fit the camera once the fresh layout has settled (not before — the
      // pre-settle blob would frame to a dot). Guarded so a restored camera or
      // later reheats never yank the view.
      onSimulationEnd: () => {
        if (!fitOnSettleRef.current) return;
        fitOnSettleRef.current = false;
        graphRef.current?.fitView(400);
      },
      onClick: (index) => {
        if (index === undefined) return;
        const node = nodesRef.current[index];
        if (!node) return;
        if (node.unresolved) onCreateNote(node.title);
        else onOpenNote(node.id, node.title);
      },
      onPointMouseOver: (index, _pos, event) => {
        const node = nodesRef.current[index];
        if (node && event instanceof MouseEvent) {
          setHovered({ title: node.title, x: event.offsetX, y: event.offsetY });
        }
        const colors = colorsRef.current;
        const adjacency = adjacencyRef.current;
        const target = colors.slice();
        for (let i = 0; i < nodesRef.current.length; i++) {
          if (i === index || adjacency[index]?.has(i)) continue;
          target[i * 4 + 3] = colors[i * 4 + 3] * 0.2;
        }
        animateColors(target);
        const dimmedLinks = baseLinkColorsRef.current.slice();
        edgesRef.current.forEach(([s, t], i) => {
          if (s !== index && t !== index) dimmedLinks[i * 4 + 3] *= 0.15;
        });
        graphRef.current?.setLinkColors(dimmedLinks);
      },
      onPointMouseOut: () => {
        setHovered(null);
        animateColors(colorsRef.current.slice());
        graphRef.current?.setLinkColors(baseLinkColorsRef.current.slice());
      },
    });
    graphRef.current = graph;

    const overlay = document.createElement("div");
    overlay.className = "pointer-events-none absolute inset-0 overflow-hidden";
    container.appendChild(overlay);
    labelRef.current = { overlay, els: new Map() };

    // node dragging needs a live sim — wake on pointerdown, refreeze after
    const onDown = () => {
      graph.unpause();
      graph.render(0.05);
    };
    const onUp = () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => graphRef.current?.pause(), 1500);
    };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointerup", onUp);

    const tick = () => {
      framesSinceApplyRef.current += 1;
      const container = containerRef.current;
      const W = container?.clientWidth ?? 0;
      const H = container?.clientHeight ?? 0;
      if (W > 0) {
        const [cx, cy] = graph.screenToSpacePosition([W / 2, H / 2]);
        cameraRef.current = [cx, cy, graph.getZoomLevel()];
      }
      const tracked = graph.getTrackedPointPositionsMap();
      const zoom = graph.getZoomLevel();
      // Global text alpha rises with zoom (Obsidian: clamp(log2(zoom)+1-fade)).
      // Shifted so labels are already legible at the fit-view zoom.
      const alpha = Math.max(0, Math.min(1, Math.log2(zoom) + 2.1));
      const els = labelRef.current?.els;
      for (const [i, pos] of tracked) {
        const el = els?.get(i);
        if (!el || !pos) continue;
        const [x, y] = graph.spaceToScreenPosition([pos[0], pos[1]]);
        // Cull labels that are hidden or off-screen so hundreds of nodes stay cheap.
        if (alpha <= 0.03 || x < -60 || x > W + 60 || y < -30 || y > H + 30) {
          if (el.style.opacity !== "0") el.style.opacity = "0";
          continue;
        }
        el.style.transform = `translate(${String(Math.round(x))}px, ${String(Math.round(y + 9))}px) translateX(-50%)`;
        el.style.opacity = String(alpha);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      harvestPositions();
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointerup", onUp);
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(dimRafRef.current);
      cancelAnimationFrame(enterRafRef.current);
      overlay.remove();
      labelRef.current = null;
      graph.destroy();
      graphRef.current = null;
      prevIdsRef.current = [];
      didFitRef.current = false;
      fitOnSettleRef.current = false;
      prevForcesRef.current = "";
      prevDisplayRef.current = "";
      appliedSigRef.current = "";
    };
    // one engine per view identity; data flows through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, centerNoteId, depth]);

  // Effect 2 — data application: diff-in-place, never destroy.
  const appliedSigRef = useRef("");
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !filtered) return;

    // identical content (query refetch, debounce identity churn) is a no-op —
    // repeated reheats would keep nudging a settled layout
    const signature = JSON.stringify({
      ids: filtered.nodes.map((node) => node.id),
      deg: filtered.nodes.map((node) => node.degree),
      edges: filtered.edges,
      groups: appliedGroups,
    });
    if (signature === appliedSigRef.current) return;
    // eslint-disable-next-line react-hooks/immutability -- ref write inside an effect
    appliedSigRef.current = signature;

    // 1. remember where everything currently is
    harvestPositions();
    const store = getPositionStore(storeKey);

    const accent = cssColor("--ob-interactive-accent", "hsl(254, 80%, 68%)");
    const nodeColor = toRgba(cssColor("--ob-text-muted", "#b3b3b3"), 1);
    const ghostColor = toRgba(cssColor("--ob-text-faint", "#666666"), 0.45);
    const focusColor = toRgba(accent, 1);
    const linkColor = toRgba(cssColor("--ob-text-faint", "#666666"), 0.85);
    const groupRgba = appliedGroups.map((g) => toRgba(g.color, 1));

    const n = filtered.nodes.length;
    const positions = new Float32Array(n * 2);
    const colors = new Float32Array(n * 4);
    const sizes = new Float32Array(n);
    const SPACE = 4096;
    const spread = Math.max(200, Math.sqrt(Math.max(n, 1)) * 60);

    // adjacency on the NEW index space (also used for neighbor seeding)
    const adjacency: Set<number>[] = filtered.nodes.map(() => new Set<number>());
    filtered.edges.forEach(([s, t]) => {
      adjacency[s].add(t);
      adjacency[t].add(s);
    });

    // pass 1: place nodes with remembered positions
    const placed = new Map<number, [number, number]>();
    let reused = 0;
    filtered.nodes.forEach((node, i) => {
      const known = store.get(node.id);
      if (known) {
        placed.set(i, known);
        reused++;
      }
    });
    // pass 2: new nodes join beside their positioned neighbors (Obsidian behavior)
    filtered.nodes.forEach((_node, i) => {
      if (placed.has(i)) return;
      const neighborPositions = [...adjacency[i]]
        .map((j) => placed.get(j))
        .filter((pos): pos is [number, number] => Boolean(pos));
      if (neighborPositions.length > 0) {
        const cx = neighborPositions.reduce((acc, pos) => acc + pos[0], 0) / neighborPositions.length;
        const cy = neighborPositions.reduce((acc, pos) => acc + pos[1], 0) / neighborPositions.length;
        placed.set(i, [cx + (Math.random() - 0.5) * 60, cy + (Math.random() - 0.5) * 60]);
      } else {
        placed.set(i, [
          SPACE / 2 + (Math.random() - 0.5) * spread,
          SPACE / 2 + (Math.random() - 0.5) * spread,
        ]);
      }
    });

    for (let i = 0; i < n; i++) {
      const node = filtered.nodes[i];
      const pos = placed.get(i) as [number, number];
      positions[i * 2] = pos[0];
      positions[i * 2 + 1] = pos[1];
      const isCenter = centerNoteId && node.id === centerNoteId;
      const gi = node.unresolved ? -1 : matchGroupIndex(node, appliedGroups);
      const c = isCenter
        ? focusColor
        : node.unresolved
          ? ghostColor
          : gi >= 0
            ? groupRgba[gi]
            : nodeColor;
      colors.set(c, i * 4);
      // Obsidian's mapping: sqrt growth of degree, clamped. Slightly smaller
      // than before so cluster cores read as dots, not chunky overlapping blobs.
      sizes[i] = Math.min(5 + 2.6 * Math.sqrt(node.degree), 22) * (isCenter ? 1.35 : 1);
    }
    const links = new Float32Array(filtered.edges.length * 2);
    filtered.edges.forEach(([s, t], i) => {
      links[i * 2] = s;
      links[i * 2 + 1] = t;
    });
    const baseLinkColors = new Float32Array(filtered.edges.length * 4);
    for (let i = 0; i < filtered.edges.length; i++) baseLinkColors.set(linkColor, i * 4);

    // Sticky selection: keep the un-focused colours/sizes as the base, then
    // accent + enlarge the focused node so the note open beside the graph
    // stands out. The focus effect below keeps this live without a rebuild.
    groupColorsRef.current = colors.slice();
    groupSizesRef.current = sizes.slice();
    focusColorRef.current = focusColor;
    const focusIdx = focusNoteId ? filtered.nodes.findIndex((nd) => nd.id === focusNoteId) : -1;
    if (focusIdx >= 0) {
      colors.set(focusColor, focusIdx * 4);
      sizes[focusIdx] = sizes[focusIdx] * 1.7;
    }
    prevFocusRef.current = focusIdx >= 0 ? filtered.nodes[focusIdx].id : null;

    // Detect nodes/links added since the last apply → fade them in. Only a
    // small, genuine growth animates (not the first build, not filter
    // reshuffles) so toggling ghosts/orphans/time-travel never fade-storms.
    cancelAnimationFrame(enterRafRef.current);
    const isFirst = !didFitRef.current;
    const restored = n > 0 && reused / n >= 0.5;
    const prevIdSet = new Set(prevIdsRef.current);
    const addedPoints: number[] = [];
    filtered.nodes.forEach((node, i) => {
      if (!prevIdSet.has(node.id)) addedPoints.push(i);
    });
    const addedPointSet = new Set(addedPoints);
    const addedLinks: number[] = [];
    filtered.edges.forEach(([s, t], i) => {
      if (addedPointSet.has(s) || addedPointSet.has(t)) addedLinks.push(i);
    });
    const animateEnter = !isFirst && restored && addedPoints.length > 0 && addedPoints.length <= 8;

    graph.setPointPositions(positions, true);
    if (animateEnter) {
      // seed the added indices invisible; runEnterAnimation ramps them up
      const initColors = colors.slice();
      const initSizes = sizes.slice();
      const initLinks = baseLinkColors.slice();
      for (const i of addedPoints) {
        initSizes[i] = 0;
        initColors[i * 4 + 3] = 0;
      }
      for (const i of addedLinks) initLinks[i * 4 + 3] = 0;
      graph.setPointColors(initColors);
      graph.setPointSizes(initSizes);
      graph.setLinks(links);
      graph.setLinkColors(initLinks);
    } else {
      graph.setPointColors(colors);
      graph.setPointSizes(sizes);
      graph.setLinks(links);
      graph.setLinkColors(baseLinkColors);
    }

    // energy: settle a brand-new layout, restore a known one statically,
    // and give incremental changes only a gentle, eased local reheat
    graph.unpause();
    if (isFirst) graph.render(restored ? 0 : 0.9);
    else graph.render(0.04, 350);
    if (animateEnter) runEnterAnimation(addedPoints, addedLinks, colors, sizes, baseLinkColors);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      graphRef.current?.pause();
      // Fallback: if the sim is paused before it naturally ends, still frame
      // the settled layout exactly once.
      if (fitOnSettleRef.current) {
        fitOnSettleRef.current = false;
        graphRef.current?.fitView(400);
      }
    }, isFirst && !restored ? 4000 : 1500);
    if (isFirst && n > 0) {
      const camera = cameraStores.get(storeKey);
      if (restored && camera) {
        // exact camera restore: center the stored viewport-center point at
        // the stored zoom; never let the camera call re-energize the sim
        graph.setZoomTransformByPointPositions(
          new Float32Array([camera[0], camera[1]]),
          0,
          camera[2],
          0,
          false,
        );
      } else {
        // Fresh layout: defer the fit until the sim settles (§onSimulationEnd),
        // otherwise the pre-settle blob frames to a dot.
        fitOnSettleRef.current = true;
      }
      didFitRef.current = true;
    }

    // labels: one per node (highest-degree first so a huge vault keeps its hubs
    // when capped). The render loop fades them by zoom and culls off-screen.
    const label = labelRef.current;
    if (label) {
      label.els.forEach((el) => el.remove());
      label.els.clear();
      const labelIndices = filtered.nodes
        .map((node, i) => ({ i, degree: node.degree }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, LABEL_CAP)
        .map((x) => x.i);
      graph.trackPointPositionsByIndices(labelIndices);
      for (const i of labelIndices) {
        const el = document.createElement("div");
        el.textContent = filtered.nodes[i].title;
        el.className = "nodum-graph-label";
        el.style.opacity = "0";
        if (!filtered.nodes[i].unresolved) {
          const hex = matchGroupHex(filtered.nodes[i], appliedGroups);
          if (hex) el.style.color = hex;
        }
        label.overlay.appendChild(el);
        label.els.set(i, el);
      }
    }

    framesSinceApplyRef.current = 0;
    nodesRef.current = filtered.nodes;
    adjacencyRef.current = adjacency;
    edgesRef.current = filtered.edges;
    colorsRef.current = colors;
    currentColorsRef.current = colors.slice();
    baseLinkColorsRef.current = baseLinkColors;
    prevIdsRef.current = filtered.nodes.map((node) => node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, appliedGroups, centerNoteId]);

  // Effect 2b — sticky "selected note" accent. Recolours just the focused node
  // on top of the base colours (no layout rebuild → no label flicker/jiggle).
  // Guarded so an unfocused graph never repaints over the enter-fade.
  useEffect(() => {
    const graph = graphRef.current;
    const base = groupColorsRef.current;
    if (!graph || base.length === 0) return;
    const idx = focusNoteId ? nodesRef.current.findIndex((nd) => nd.id === focusNoteId) : -1;
    if (idx < 0 && prevFocusRef.current === null) {
      colorsRef.current = base; // nothing focused, nothing to clear — leave the paint alone
      return;
    }
    const colors = base.slice();
    const sizes = groupSizesRef.current.slice();
    if (idx >= 0) {
      colors.set(focusColorRef.current, idx * 4);
      sizes[idx] = groupSizesRef.current[idx] * 1.7;
    }
    colorsRef.current = colors;
    currentColorsRef.current = colors.slice();
    graph.setPointColors(colors);
    graph.setPointSizes(sizes);
    graph.render(0); // redraw a settled/paused graph so the accent shows at once
    prevFocusRef.current = idx >= 0 ? focusNoteId : null;
  }, [focusNoteId, filtered]);

  // Effect 3 — force sliders update the live simulation (no teardown).
  // Only a REAL value change reheats; mounts and identity churn must not
  // re-energize a settled layout.
  const prevForcesRef = useRef("");
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const key = JSON.stringify(applied);
    if (prevForcesRef.current === key) return;
    const firstRun = prevForcesRef.current === "";
    // eslint-disable-next-line react-hooks/immutability -- ref write inside an effect
    prevForcesRef.current = key;
    graph.setConfigPartial({
      simulationCenter: applied.centerForce,
      simulationRepulsion: applied.repelForce,
      simulationLinkDistance: applied.linkDistance,
      simulationLinkSpring: applied.linkForce,
    });
    if (!firstRun) graph.render(0.3);
  }, [applied]);

  // Display config (arrows / node size / link thickness) — pure visuals,
  // applied immediately without touching the simulation.
  const prevDisplayRef = useRef("");
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const key = JSON.stringify({ arrows, nodeSize, linkThickness });
    if (prevDisplayRef.current === key) return;
    // eslint-disable-next-line react-hooks/immutability -- ref write inside an effect
    prevDisplayRef.current = key;
    graph.setConfigPartial({
      linkDefaultArrows: arrows,
      pointSizeScale: nodeSize,
      linkWidthScale: linkThickness,
    });
  }, [arrows, nodeSize, linkThickness]);

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

      {/* Controls — Obsidian's floating gear popover + reset (top-right) */}
      {!compact && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          <button
            type="button"
            aria-label="Reset graph settings"
            onClick={resetToDefaults}
            className="flex size-8 items-center justify-center rounded-md border border-ob-border bg-ob-sidebar/95 text-ob-muted shadow-lg backdrop-blur transition-colors hover:text-ob-text"
          >
            <RotateCcw className="size-4" strokeWidth={1.75} />
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Graph settings"
                className="flex size-8 items-center justify-center rounded-md border border-ob-border bg-ob-sidebar/95 text-ob-muted shadow-lg backdrop-blur transition-colors hover:text-ob-text"
              >
                <Settings2 className="size-4" strokeWidth={1.75} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              onOpenAutoFocus={(e) => e.preventDefault()}
              className="max-h-[70vh] w-64 overflow-y-auto border-ob-border bg-ob-sidebar p-3 text-[12px]"
            >
        <p className="pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Filters</p>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files… (path: tag: text)"
          aria-label="Search graph"
          className="mb-1.5 h-7 w-full rounded border border-ob-border bg-ob-bg px-2 text-[12px] text-ob-text outline-none placeholder:text-ob-faint focus:border-ob-accent"
        />
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

        <p className="pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Display</p>
        <label className="flex items-center justify-between py-0.5 text-ob-muted">
          Arrows
          <input
            type="checkbox"
            checked={arrows}
            onChange={(e) => setArrowsDraft(e.target.checked)}
            className="accent-[var(--ob-interactive-accent)]"
          />
        </label>
        <ForceSlider label="Node size" min={0.1} max={5} step={0.1} value={nodeSize} onChange={setNodeSizeDraft} />
        <ForceSlider label="Link thickness" min={0.1} max={5} step={0.1} value={linkThickness} onChange={setThicknessDraft} />

        <p className="pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase">Forces</p>
        <ForceSlider label="Center force" min={0} max={1} step={0.05} value={centerForce} onChange={setCenterDraft} />
        <ForceSlider label="Repel force" min={0.1} max={8} step={0.1} value={repelForce} onChange={setRepelDraft} />
        <ForceSlider label="Link force" min={0} max={2} step={0.1} value={linkForce} onChange={setLinkForceDraft} />
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
            </PopoverContent>
          </Popover>
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
