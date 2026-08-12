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

interface WorkspaceState {
  activeVaultId: string | null;
  tabs: Tab[];
  activeTabId: string | null;
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
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
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
      tabs: [],
      activeTabId: null,
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
          set({ activeVaultId: vaultId, tabs: [], activeTabId: null });
        }
      },

      openTab: (tab) => {
        const { tabs } = get();
        if (!tabs.some((t) => t.id === tab.id)) {
          set({ tabs: [...tabs, tab] });
        }
        set({ activeTabId: tab.id });
      },

      // ⌘Enter in the switcher — the tab appears but focus stays put
      openTabBackground: (tab) => {
        const { tabs, activeTabId } = get();
        if (!tabs.some((t) => t.id === tab.id)) {
          set({ tabs: [...tabs, tab] });
        }
        if (activeTabId === null) set({ activeTabId: tab.id });
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId } = get();
        const remaining = tabs.filter((t) => t.id !== tabId);
        const nextActive =
          activeTabId === tabId ? (remaining.at(-1)?.id ?? null) : activeTabId;
        set({ tabs: remaining, activeTabId: nextActive });
      },

      setActiveTab: (tabId) => set({ activeTabId: tabId }),
      renameTab: (tabId, title) =>
        set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) }),
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
      partialize: (s) => ({
        activeVaultId: s.activeVaultId,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
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
