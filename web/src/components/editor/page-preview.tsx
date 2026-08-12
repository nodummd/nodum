"use client";

/**
 * Page preview popover — Obsidian's Cmd/Ctrl+hover peek. Surfaces attach
 * mouseover/mouseout handlers (via previewHoverHandlers) on containers whose
 * descendants carry data-wikilink-target; the popover renders a ReadingView
 * excerpt near the pointer. Display-only (pointer-events: none).
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { noteApi, searchApi } from "@/lib/api/endpoints";
import { ReadingView } from "./reading-view";

export interface PreviewAnchor {
  target: string;
  x: number;
  y: number;
}

const WIDTH = 360;
const MAX_HEIGHT = 280;

/** Strip frontmatter and cap length — the popover is a peek, not the note. */
function excerpt(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n?/, "").trimStart();
  return body.length > 700 ? `${body.slice(0, 700)}…` : body;
}

export function usePagePreview() {
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null);

  const handlers = {
    onMouseOver: (e: React.MouseEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const el = (e.target as HTMLElement).closest?.("[data-wikilink-target]");
      const target = el?.getAttribute("data-wikilink-target");
      if (target) setAnchor({ target, x: e.clientX, y: e.clientY });
    },
    onMouseOut: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-wikilink-target]")) setAnchor(null);
    },
    onMouseDown: () => setAnchor(null),
  };
  return { anchor, handlers };
}

export function PagePreview({ vaultId, anchor }: { vaultId: string; anchor: PreviewAnchor }) {
  const { data: note, isError } = useQuery({
    queryKey: ["page-preview", vaultId, anchor.target],
    queryFn: async () => {
      try {
        return await noteApi.getByPath(vaultId, anchor.target);
      } catch {
        const candidates = await searchApi.quickSwitch(vaultId, anchor.target, 5);
        const wanted = anchor.target.toLowerCase();
        const exact = candidates.find(
          (c) => c.title.toLowerCase() === wanted || c.alias?.toLowerCase() === wanted,
        );
        if (!exact) throw new Error("not found");
        return await noteApi.get(vaultId, exact.id);
      }
    },
    staleTime: 30_000,
    retry: false,
  });

  if (typeof window === "undefined") return null;
  const left = Math.min(anchor.x + 14, window.innerWidth - WIDTH - 12);
  const top =
    anchor.y + 18 + MAX_HEIGHT > window.innerHeight
      ? Math.max(8, anchor.y - MAX_HEIGHT - 12)
      : anchor.y + 18;

  return (
    <div
      className="nodum-page-preview pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-ob-border bg-[var(--ob-color-base-25)] p-3 shadow-2xl"
      style={{ left, top, width: WIDTH, maxHeight: MAX_HEIGHT }}
    >
      {isError ? (
        <p className="text-[13px] text-ob-faint">
          “{anchor.target}” hasn’t been created yet.
        </p>
      ) : note ? (
        <>
          <p className="mb-1 truncate text-[13px] font-semibold text-ob-text">{note.title}</p>
          <div className="nodum-preview-body text-[13px]">
            <ReadingView
              content={excerpt(note.content)}
              vaultId={vaultId}
              onNavigate={() => undefined}
              depth={2}
            />
          </div>
        </>
      ) : (
        <p className="text-[13px] text-ob-faint">Loading…</p>
      )}
    </div>
  );
}
