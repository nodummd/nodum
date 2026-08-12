"use client";

/** Left sidebar — Files / Search tab strip + resize handle (Obsidian style). */

import { Bookmark, Files, Search } from "lucide-react";
import { useCallback, useRef } from "react";

import { BookmarksPane } from "./bookmarks-pane";
import { FileExplorer } from "./file-explorer";
import { CanvasesSection } from "./canvases-section";
import { SearchPane } from "./search-pane";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

export function SidebarLeft({
  vaultId,
  vaultName,
  activeNoteId,
  onOpenNote,
  drawer = false,
}: {
  vaultId: string;
  vaultName: string;
  activeNoteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
  /** Drawer mode (mobile): fill the parent, no resize handle, ignore open flag. */
  drawer?: boolean;
}) {
  const open = useWorkspaceStore((s) => s.leftSidebarOpen);
  const width = useWorkspaceStore((s) => s.leftWidth);
  const setWidth = useWorkspaceStore((s) => s.setLeftWidth);
  // Pane lives in the store so other panels (tag pane) can open Search
  const pane = useWorkspaceStore((s) => s.leftPane);
  const setPane = useWorkspaceStore((s) => s.setLeftPane);
  const dragging = useRef(false);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: PointerEvent) => {
        if (dragging.current) setWidth(startWidth + (ev.clientX - startX));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, setWidth],
  );

  if (!drawer && !open) return null;

  return (
    <div
      className="relative flex shrink-0 flex-col bg-ob-sidebar"
      style={drawer ? { width: "100%", height: "100%" } : { width }}
    >
      <div className="flex items-center gap-0.5 border-b border-ob-border px-2 py-1">
        <PaneTab
          label="Files"
          active={pane === "files"}
          onClick={() => setPane("files")}
          icon={<Files className="size-4" strokeWidth={1.75} />}
        />
        <PaneTab
          label="Search"
          active={pane === "search"}
          onClick={() => setPane("search")}
          icon={<Search className="size-4" strokeWidth={1.75} />}
        />
        <PaneTab
          label="Bookmarks"
          active={pane === "bookmarks"}
          onClick={() => setPane("bookmarks")}
          icon={<Bookmark className="size-4" strokeWidth={1.75} />}
        />
        <span className="ml-auto truncate pr-1 text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          {vaultName}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {pane === "files" && (
          <>
            <div className="min-h-0 flex-1">
              <FileExplorer vaultId={vaultId} activeNoteId={activeNoteId} onOpenNote={onOpenNote} />
            </div>
            <CanvasesSection vaultId={vaultId} />
          </>
        )}
        {pane === "search" && <SearchPane vaultId={vaultId} onOpenNote={onOpenNote} />}
        {pane === "bookmarks" && <BookmarksPane vaultId={vaultId} onOpenNote={onOpenNote} />}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onDragStart}
        className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-ob-accent/40"
      />
    </div>
  );
}

function PaneTab({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-colors duration-150",
            active ? "bg-ob-active text-ob-text" : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
