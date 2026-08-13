"use client";

/**
 * Drop overlay for tab drag-and-drop (S13.2). Appears over each pane body only
 * while a tab is being dragged. Dropping near an edge splits the pane on that
 * side (left/right → side-by-side, top/bottom → stacked); dropping in the
 * centre moves the tab into this pane.
 */

import { useState } from "react";

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

type Zone = "left" | "right" | "top" | "bottom" | "center";

function zoneFor(e: React.DragEvent, el: HTMLElement): Zone {
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const dist = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  const nearest = (Object.keys(dist) as Exclude<Zone, "center">[]).reduce((a, b) =>
    dist[a] <= dist[b] ? a : b,
  );
  return dist[nearest] > 0.28 ? "center" : nearest;
}

const HIGHLIGHT: Record<Zone, string> = {
  left: "left-0 top-0 h-full w-1/2",
  right: "right-0 top-0 h-full w-1/2",
  top: "left-0 top-0 h-1/2 w-full",
  bottom: "left-0 bottom-0 h-1/2 w-full",
  center: "inset-0",
};

export function PaneDropOverlay({ paneIndex }: { paneIndex: number }) {
  const dragging = useWorkspaceStore((s) => s.dragging);
  const splitWithTab = useWorkspaceStore((s) => s.splitWithTab);
  const moveTabToPane = useWorkspaceStore((s) => s.moveTabToPane);
  const setDragging = useWorkspaceStore((s) => s.setDragging);
  const [zone, setZone] = useState<Zone | null>(null);

  if (!dragging) return null;

  return (
    <div
      data-pane-drop={paneIndex}
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setZone(zoneFor(e, e.currentTarget));
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        const drag = useWorkspaceStore.getState().dragging;
        const z = zoneFor(e, e.currentTarget);
        setZone(null);
        if (!drag) return;
        if (z === "center") {
          const target = useWorkspaceStore.getState().panes[paneIndex];
          moveTabToPane(drag.tabId, drag.fromPaneIndex, paneIndex, target?.tabs.length ?? 0);
        } else {
          splitWithTab(drag.tabId, drag.fromPaneIndex, z);
        }
        setDragging(null);
      }}
    >
      {zone && (
        <div
          className={cn(
            "pointer-events-none absolute rounded-sm bg-ob-accent/25 ring-1 ring-ob-accent/60",
            HIGHLIGHT[zone],
          )}
        />
      )}
    </div>
  );
}
