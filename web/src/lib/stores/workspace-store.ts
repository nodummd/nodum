"use client";

/**
 * Workspace UI state — open tabs, sidebars, active view.
 * Server data (notes, tree, graph) lives in react-query; this store only
 * holds layout/UI state, persisted per browser.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MainView =
  | { kind: "note"; noteId: string }
  | { kind: "graph" }
  | { kind: "empty" };

export type EditorMode = "live" | "source" | "reading";

export type ExplorerSort =
  | "title-asc"
  | "title-desc"
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc";

export interface Tab {
  id: string; // note id, or "graph"
  kind: "note" | "graph";
  title: string;
}

export interface PaneState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface WorkspaceState {
  activeVaultId: string | null;
  /** 1 or 2 editor panes (split view). */
  panes: PaneState[];
  activePane: number;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  editorMode: EditorMode;
  explorerSort: ExplorerSort;
  paletteOpen: boolean;
  switcherOpen: boolean;
  versionsOpen: boolean;
  leftPane: "files" | "search" | "bookmarks";
  /** One-shot query seed for the search pane (tag pane click-to-search). */
  searchSeed: string | null;

  setActiveVault: (vaultId: string | null) => void;
  openTab: (tab: Tab) => void;
  openTabBackground: (tab: Tab) => void;
  /** paneIndex omitted → close in every pane (e.g. the note was deleted). */
  closeTab: (tabId: string, paneIndex?: number) => void;
  setActiveTab: (tabId: string, paneIndex?: number) => void;
  renameTab: (tabId: string, title: string) => void;
  setActivePane: (index: number) => void;
  splitRight: () => void;
  closePane: (index: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setEditorMode: (mode: EditorMode) => void;
  setExplorerSort: (sort: ExplorerSort) => void;
  setPaletteOpen: (open: boolean) => void;
  setSwitcherOpen: (open: boolean) => void;
  setVersionsOpen: (open: boolean) => void;
  setLeftPane: (pane: "files" | "search" | "bookmarks") => void;
  setSearchSeed: (q: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      activeVaultId: null,
      panes: [{ tabs: [], activeTabId: null }],
      activePane: 0,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      leftWidth: 280,
      rightWidth: 300,
      editorMode: "live",
      explorerSort: "title-asc",
      paletteOpen: false,
      switcherOpen: false,
      versionsOpen: false,
      leftPane: "files",
      searchSeed: null,

      setActiveVault: (vaultId) => {
        if (get().activeVaultId !== vaultId) {
          set({ activeVaultId: vaultId, panes: [{ tabs: [], activeTabId: null }], activePane: 0 });
        }
      },

      openTab: (tab) => {
        const { panes, activePane } = get();
        set({
          panes: panes.map((p, i) =>
            i === activePane
              ? {
                  tabs: p.tabs.some((t) => t.id === tab.id) ? p.tabs : [...p.tabs, tab],
                  activeTabId: tab.id,
                }
              : p,
          ),
        });
      },

      // ⌘Enter in the switcher — the tab appears but focus stays put
      openTabBackground: (tab) => {
        const { panes, activePane } = get();
        set({
          panes: panes.map((p, i) =>
            i === activePane
              ? {
                  tabs: p.tabs.some((t) => t.id === tab.id) ? p.tabs : [...p.tabs, tab],
                  activeTabId: p.activeTabId ?? tab.id,
                }
              : p,
          ),
        });
      },

      closeTab: (tabId, paneIndex) => {
        const panes = get().panes.map((p, i) => {
          if (paneIndex !== undefined && i !== paneIndex) return p;
          if (!p.tabs.some((t) => t.id === tabId)) return p;
          const remaining = p.tabs.filter((t) => t.id !== tabId);
          return {
            tabs: remaining,
            activeTabId:
              p.activeTabId === tabId ? (remaining.at(-1)?.id ?? null) : p.activeTabId,
          };
        });
        // a second pane that runs out of tabs disappears
        const kept = panes.filter((p, i) => i === 0 || p.tabs.length > 0);
        set({ panes: kept, activePane: Math.min(get().activePane, kept.length - 1) });
      },

      setActiveTab: (tabId, paneIndex) => {
        const { panes, activePane } = get();
        const target =
          paneIndex ?? panes.findIndex((p) => p.tabs.some((t) => t.id === tabId));
        const index = target === -1 ? activePane : target;
        set({
          panes: panes.map((p, i) => (i === index ? { ...p, activeTabId: tabId } : p)),
          activePane: index,
        });
      },

      renameTab: (tabId, title) =>
        set({
          panes: get().panes.map((p) => ({
            ...p,
            tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
          })),
        }),

      setActivePane: (index) =>
        set({ activePane: Math.min(index, get().panes.length - 1) }),

      splitRight: () => {
        const { panes, activePane } = get();
        if (panes.length >= 2) return;
        const current = panes[activePane];
        const active = current.tabs.find((t) => t.id === current.activeTabId);
        if (!active) return;
        set({
          panes: [...panes, { tabs: [active], activeTabId: active.id }],
          activePane: panes.length,
        });
      },

      closePane: (index) => {
        const { panes } = get();
        if (panes.length < 2 || index === 0) return;
        set({ panes: panes.slice(0, 1), activePane: 0 });
      },
      toggleLeftSidebar: () => set({ leftSidebarOpen: !get().leftSidebarOpen }),
      toggleRightSidebar: () => set({ rightSidebarOpen: !get().rightSidebarOpen }),
      setLeftWidth: (w) => set({ leftWidth: Math.min(Math.max(w, 200), 480) }),
      setRightWidth: (w) => set({ rightWidth: Math.min(Math.max(w, 220), 520) }),
      setEditorMode: (mode) => set({ editorMode: mode }),
      setExplorerSort: (sort) => set({ explorerSort: sort }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setSwitcherOpen: (open) => set({ switcherOpen: open }),
      setVersionsOpen: (open) => set({ versionsOpen: open }),
      setLeftPane: (pane) => set({ leftPane: pane }),
      setSearchSeed: (q) => set({ searchSeed: q }),
    }),
    {
      name: "nodum-workspace",
      version: 2,
      migrate: (persisted: unknown) => {
        const old = persisted as {
          tabs?: Tab[];
          activeTabId?: string | null;
          panes?: PaneState[];
        } & Record<string, unknown>;
        if (!old.panes && old.tabs) {
          old.panes = [{ tabs: old.tabs, activeTabId: old.activeTabId ?? null }];
          old.activePane = 0;
        }
        return old;
      },
      partialize: (s) => ({
        activeVaultId: s.activeVaultId,
        panes: s.panes,
        activePane: s.activePane,
        leftSidebarOpen: s.leftSidebarOpen,
        rightSidebarOpen: s.rightSidebarOpen,
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        editorMode: s.editorMode,
        explorerSort: s.explorerSort,
      }),
    },
  ),
);
