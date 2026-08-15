"use client";

/** Tab bar — Obsidian-style workspace tabs, one bar per editor pane. */

import { GitFork, Pin, Plus, X } from "lucide-react";
import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

export function TabBar({ paneIndex, onNewNote }: { paneIndex: number; onNewNote: () => void }) {
  const pane = useWorkspaceStore((s) => s.panes[paneIndex]);
  const isActivePane = useWorkspaceStore((s) => s.activePane === paneIndex);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const togglePin = useWorkspaceStore((s) => s.togglePin);
  const splitRight = useWorkspaceStore((s) => s.splitRight);
  const setDragging = useWorkspaceStore((s) => s.setDragging);
  const reorderTab = useWorkspaceStore((s) => s.reorderTab);
  const moveTabToPane = useWorkspaceStore((s) => s.moveTabToPane);
  const dragging = useWorkspaceStore((s) => s.dragging);
  // VS Code-style live insertion indicator: where the dragged tab will land.
  const [caret, setCaret] = useState<{ index: number; x: number } | null>(null);

  if (!pane) return null;

  // Last line of defence against a pane holding the same tab id twice: React
  // would throw on the duplicate key. moveTabToPane and the persist `merge`
  // both prevent it, but a corrupted layout from an older build could still
  // reach here — dedupe at render so it can never crash.
  const tabs = pane.tabs.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);

  // The tab boundary the cursor is nearest → insertion index + its x (for the
  // caret), content-relative so it stays correct when the strip scrolls.
  const caretFor = (strip: HTMLElement, clientX: number): { index: number; x: number } => {
    const stripRect = strip.getBoundingClientRect();
    const tabEls = [...strip.querySelectorAll('[role="tab"]')] as HTMLElement[];
    for (let i = 0; i < tabEls.length; i++) {
      const r = tabEls[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        return { index: i, x: r.left - stripRect.left + strip.scrollLeft };
      }
    }
    const last = tabEls.at(-1);
    return {
      index: tabEls.length,
      x: last ? last.getBoundingClientRect().right - stripRect.left + strip.scrollLeft : 4,
    };
  };

  const onStripDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const drag = useWorkspaceStore.getState().dragging;
    setCaret(null);
    if (!drag) return;
    const toIndex = caretFor(e.currentTarget as HTMLElement, e.clientX).index;
    if (drag.fromPaneIndex === paneIndex) reorderTab(drag.tabId, paneIndex, toIndex);
    else moveTabToPane(drag.tabId, drag.fromPaneIndex, paneIndex, toIndex);
    setDragging(null);
  };

  return (
    <div
      onDragOver={(e) => {
        if (!useWorkspaceStore.getState().dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setCaret(caretFor(e.currentTarget, e.clientX));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setCaret(null);
      }}
      onDrop={onStripDrop}
      className={cn(
        "relative flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b bg-ob-sidebar-alt px-1 pt-1",
        isActivePane ? "border-ob-border" : "border-ob-border opacity-80",
      )}
    >
      {caret && dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-0 z-10 w-0.5 rounded-full bg-ob-accent"
          style={{ left: caret.x - 1 }}
        />
      )}
      {tabs.map((tab) => {
        const active = tab.id === pane.activeTabId;
        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={active && isActivePane}
                tabIndex={0}
                draggable
                onDragStart={(e) => {
                  setDragging({ tabId: tab.id, fromPaneIndex: paneIndex });
                  e.dataTransfer.setData("text/plain", tab.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragging(null)}
                onClick={() => setActiveTab(tab.id, paneIndex)}
                onKeyDown={(e) => e.key === "Enter" && setActiveTab(tab.id, paneIndex)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(tab.id, paneIndex);
                }}
                className={cn(
                  "group flex min-w-0 max-w-52 flex-1 cursor-grab items-center gap-1.5 rounded-t-md px-3 text-[13px] transition-[background-color,color,opacity] duration-150 active:cursor-grabbing",
                  active
                    ? "bg-ob-bg text-ob-text"
                    : "bg-transparent text-ob-faint hover:bg-ob-hover hover:text-ob-muted",
                  dragging?.tabId === tab.id && "opacity-40",
                )}
              >
                {tab.kind === "graph" && (
                  <GitFork className="size-3.5 shrink-0 rotate-90" strokeWidth={1.75} />
                )}
                {tab.pinned && (
                  <Pin
                    aria-label={`${tab.title} is pinned`}
                    className="size-3 shrink-0 text-ob-accent"
                    strokeWidth={2}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                {!tab.pinned && (
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id, paneIndex);
                    }}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-ob-active",
                      active ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                    )}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => togglePin(tab.id, paneIndex)}>
                {tab.pinned ? "Unpin" : "Pin"}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => splitRight()}>Split right</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={Boolean(tab.pinned)}
                onSelect={() => closeTab(tab.id, paneIndex)}
              >
                Close
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        onClick={onNewNote}
        className="mb-1 ml-1 flex w-8 shrink-0 items-center justify-center self-center rounded-md py-1 text-ob-faint hover:bg-ob-hover hover:text-ob-text"
      >
        <Plus className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
