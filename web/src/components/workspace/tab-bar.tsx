"use client";

/** Tab bar — Obsidian-style workspace tabs, one bar per editor pane. */

import { GitFork, Plus, X } from "lucide-react";

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

export function TabBar({ paneIndex, onNewNote }: { paneIndex: number; onNewNote: () => void }) {
  const pane = useWorkspaceStore((s) => s.panes[paneIndex]);
  const isActivePane = useWorkspaceStore((s) => s.activePane === paneIndex);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  if (!pane) return null;

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b bg-ob-sidebar-alt px-1 pt-1",
        isActivePane ? "border-ob-border" : "border-ob-border opacity-80",
      )}
    >
      {pane.tabs.map((tab) => {
        const active = tab.id === pane.activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active && isActivePane}
            tabIndex={0}
            onClick={() => setActiveTab(tab.id, paneIndex)}
            onKeyDown={(e) => e.key === "Enter" && setActiveTab(tab.id, paneIndex)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id, paneIndex);
            }}
            className={cn(
              "group flex min-w-0 max-w-52 flex-1 cursor-default items-center gap-1.5 rounded-t-md px-3 text-[13px] transition-colors duration-150",
              active
                ? "bg-ob-bg text-ob-text"
                : "bg-transparent text-ob-faint hover:bg-ob-hover hover:text-ob-muted",
            )}
          >
            {tab.kind === "graph" && (
              <GitFork className="size-3.5 shrink-0 rotate-90" strokeWidth={1.75} />
            )}
            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
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
          </div>
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
