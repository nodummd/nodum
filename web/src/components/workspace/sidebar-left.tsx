"use client";

/** Left sidebar — Files / Search tab strip + resize handle (Obsidian style). */

import { Bookmark, Files, Import, Search } from "lucide-react";
import { useCallback, useRef } from "react";

import { BookmarksPane } from "./bookmarks-pane";
import { FileExplorer } from "./file-explorer";
import { CanvasesSection } from "./canvases-section";
import { SearchPane } from "./search-pane";
import { VaultSwitcher } from "./vault-switcher";
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
      data-tour="explorer"
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
        {/* Hairline, because this one is not a fourth pane: the tabs to its
            left switch what is below, this opens a dialog. */}
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-ob-border" />
        <ImportDataButton />
        <VaultSwitcher vaultId={vaultId} vaultName={vaultName} />
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

/** Opens the Import & sync dialog.
 *
 *  Shaped like a PaneTab so the strip reads as one row, but deliberately not
 *  one: no `aria-pressed`, because it toggles nothing — `aria-haspopup` says
 *  what actually happens. The label lives on the tooltip, like its neighbours. */
function ImportDataButton() {
  const setImportOpen = useWorkspaceStore((s) => s.setImportOpen);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Import data"
          aria-haspopup="dialog"
          data-testid="import-data-button"
          onClick={() => setImportOpen(true)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ob-faint transition-colors duration-150 hover:bg-ob-hover hover:text-ob-text"
        >
          <Import className="size-4" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Import data</TooltipContent>
    </Tooltip>
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
