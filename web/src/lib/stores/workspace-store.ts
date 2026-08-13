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

/** Right-sidebar panels (mirrors sidebar-right.tsx). */
export type RightPaneKind = "backlinks" | "outgoing" | "tags" | "outline" | "local-graph";

export type ExplorerSort =
  | "title-asc"
  | "title-desc"
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc";

export interface Tab {
  id: string; // note id, canvas id, or "graph"
  kind: "note" | "graph" | "canvas";
  title: string;
  /** Pinned tabs sort first, hide their close button, and ⌘W skips them. */
  pinned?: boolean;
}

export interface PaneState {
  tabs: Tab[];
  activeTabId: string | null;
  /** Navigation history of tab ids (⌘[ / ⌘]). */
  history: string[];
  historyIndex: number;
}

const emptyPane = (): PaneState => ({ tabs: [], activeTabId: null, history: [], historyIndex: -1 });

/** Pinned first, original order otherwise. */
function sortPinned(tabs: Tab[]): Tab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

/** Append to a pane's history (truncating any forward entries). */
function recorded(p: PaneState, tabId: string): Pick<PaneState, "history" | "historyIndex"> {
  if (p.history[p.historyIndex] === tabId) {
    return { history: p.history, historyIndex: p.historyIndex };
  }
  const history = [...p.history.slice(0, p.historyIndex + 1), tabId].slice(-50);
  return { history, historyIndex: history.length - 1 };
}

interface WorkspaceState {
  activeVaultId: string | null;
  /** 1 or 2 editor panes (split view). */
  panes: PaneState[];
  activePane: number;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  /** Which right-sidebar panel is showing. */
  rightPane: RightPaneKind;
  /** Left icon ribbon visibility (Obsidian's "Toggle ribbon"). */
  ribbonVisible: boolean;
  leftWidth: number;
  rightWidth: number;
  /** Fraction of the editor area given to the first pane when split (0.2–0.8). */
  splitRatio: number;
  /** Split axis: side-by-side ("row") or stacked ("column"). */
  splitOrientation: "row" | "column";
  /** Transient drag state for tab drag-and-drop (never persisted). */
  dragging: { tabId: string; fromPaneIndex: number } | null;
  editorMode: EditorMode;
  /** User's "default view for new tabs" pref (runtime mirror, not persisted). */
  defaultEditorMode: EditorMode;
  explorerSort: ExplorerSort;
  paletteOpen: boolean;
  switcherOpen: boolean;
  versionsOpen: boolean;
  leftPane: "files" | "search" | "bookmarks";
  /** One-shot query seed for the search pane (tag pane click-to-search). */
  searchSeed: string | null;

  setActiveVault: (vaultId: string | null) => void;
  /** adoptDefaultMode=false: in-editor link navigation keeps the current view mode. */
  openTab: (tab: Tab, opts?: { adoptDefaultMode?: boolean }) => void;
  openTabBackground: (tab: Tab) => void;
  /** paneIndex omitted → close in every pane (e.g. the note was deleted). */
  closeTab: (tabId: string, paneIndex?: number) => void;
  /** Close every tab in the active pane except the active one and pinned tabs. */
  closeOtherTabs: () => void;
  setActiveTab: (tabId: string, paneIndex?: number) => void;
  /** Activate the tab at index in the active pane; -1 selects the last tab. */
  goToTabIndex: (index: number) => void;
  /** Cycle the active pane's tab selection (+1 next, -1 previous, wraps). */
  goToRelativeTab: (dir: 1 | -1) => void;
  renameTab: (tabId: string, title: string) => void;
  setActivePane: (index: number) => void;
  splitRight: () => void;
  closePane: (index: number) => void;
  togglePin: (tabId: string, paneIndex: number) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setRightPane: (pane: RightPaneKind) => void;
  toggleRibbon: () => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setSplitRatio: (ratio: number) => void;
  setDragging: (d: { tabId: string; fromPaneIndex: number } | null) => void;
  /** Reorder a tab within its pane. */
  reorderTab: (tabId: string, paneIndex: number, toIndex: number) => void;
  /** Move a tab to another existing pane (falls back to reorder if same pane). */
  moveTabToPane: (tabId: string, fromPaneIndex: number, toPaneIndex: number, toIndex: number) => void;
  /** Drop a tab on a pane edge → split into two panes on that side. */
  splitWithTab: (tabId: string, fromPaneIndex: number, edge: "left" | "right" | "top" | "bottom") => void;
  setEditorMode: (mode: EditorMode) => void;
  setDefaultEditorMode: (mode: EditorMode) => void;
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
      panes: [emptyPane()],
      activePane: 0,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      rightPane: "backlinks",
      ribbonVisible: true,
      leftWidth: 280,
      rightWidth: 300,
      splitRatio: 0.5,
      splitOrientation: "row",
      dragging: null,
      editorMode: "live",
      defaultEditorMode: "live",
      explorerSort: "title-asc",
      paletteOpen: false,
      switcherOpen: false,
      versionsOpen: false,
      leftPane: "files",
      searchSeed: null,

      setActiveVault: (vaultId) => {
        if (get().activeVaultId !== vaultId) {
          set({ activeVaultId: vaultId, panes: [emptyPane()], activePane: 0 });
        }
      },

      openTab: (tab, opts) => {
        const { panes, activePane, editorMode, defaultEditorMode } = get();
        // Obsidian's "default view for new tabs": a genuinely new tab adopts
        // the configured mode; re-activating an open tab keeps the current one,
        // and link-follow navigation (adoptDefaultMode: false) keeps it too.
        const adopt = opts?.adoptDefaultMode ?? true;
        const isNew = !panes[activePane].tabs.some((t) => t.id === tab.id);
        set({
          editorMode: adopt && isNew && tab.kind === "note" ? defaultEditorMode : editorMode,
          panes: panes.map((p, i) =>
            i === activePane
              ? {
                  ...p,
                  tabs: p.tabs.some((t) => t.id === tab.id)
                    ? p.tabs
                    : sortPinned([...p.tabs, tab]),
                  activeTabId: tab.id,
                  ...recorded(p, tab.id),
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
                  ...p,
                  tabs: p.tabs.some((t) => t.id === tab.id)
                    ? p.tabs
                    : sortPinned([...p.tabs, tab]),
                  activeTabId: p.activeTabId ?? tab.id,
                }
              : p,
          ),
        });
      },

      closeTab: (tabId, paneIndex) => {
        const panes = get().panes.map((p, i) => {
          if (paneIndex !== undefined && i !== paneIndex) return p;
          const idx = p.tabs.findIndex((t) => t.id === tabId);
          const tab = p.tabs[idx];
          if (!tab || tab.pinned) return p;
          const remaining = p.tabs.filter((t) => t.id !== tabId);
          // On closing the active tab, activate its neighbor — the tab that
          // slid into the freed slot (right neighbor), else the one to its
          // left (Obsidian-style, keeps focus near where you were).
          const activeTabId =
            p.activeTabId === tabId
              ? (remaining[idx]?.id ?? remaining[idx - 1]?.id ?? null)
              : p.activeTabId;
          return { ...p, tabs: remaining, activeTabId };
        });
        // a second pane that runs out of tabs disappears
        const kept = panes.filter((p, i) => i === 0 || p.tabs.length > 0);
        set({ panes: kept, activePane: Math.min(get().activePane, kept.length - 1) });
      },

      closeOtherTabs: () => {
        const { panes, activePane } = get();
        set({
          panes: panes.map((p, i) =>
            i === activePane
              ? { ...p, tabs: p.tabs.filter((t) => t.id === p.activeTabId || t.pinned) }
              : p,
          ),
        });
      },

      setActiveTab: (tabId, paneIndex) => {
        const { panes, activePane } = get();
        const target =
          paneIndex ?? panes.findIndex((p) => p.tabs.some((t) => t.id === tabId));
        const index = target === -1 ? activePane : target;
        set({
          panes: panes.map((p, i) =>
            i === index ? { ...p, activeTabId: tabId, ...recorded(p, tabId) } : p,
          ),
          activePane: index,
        });
      },

      goToTabIndex: (index) => {
        const { panes, activePane } = get();
        const p = panes[activePane];
        if (!p || p.tabs.length === 0) return;
        const target = index === -1 ? p.tabs.at(-1) : p.tabs[index];
        if (target) get().setActiveTab(target.id, activePane);
      },

      goToRelativeTab: (dir) => {
        const { panes, activePane } = get();
        const p = panes[activePane];
        if (!p || p.tabs.length === 0) return;
        const cur = p.tabs.findIndex((t) => t.id === p.activeTabId);
        const next = ((cur < 0 ? 0 : cur) + dir + p.tabs.length) % p.tabs.length;
        get().setActiveTab(p.tabs[next].id, activePane);
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
          panes: [
            ...panes,
            { tabs: [active], activeTabId: active.id, history: [active.id], historyIndex: 0 },
          ],
          activePane: panes.length,
        });
      },

      // Close a whole tab group (pane). With a single pane this is a no-op —
      // there's always at least one; otherwise drop it and keep the survivor.
      closePane: (index) => {
        const { panes } = get();
        if (panes.length < 2) return;
        set({ panes: panes.filter((_, i) => i !== index), activePane: 0 });
      },

      togglePin: (tabId, paneIndex) =>
        set({
          panes: get().panes.map((p, i) =>
            i === paneIndex
              ? {
                  ...p,
                  tabs: sortPinned(
                    p.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)),
                  ),
                }
              : p,
          ),
        }),

      // ⌘[ / ⌘] — walk the active pane's history, skipping closed tabs
      navigateBack: () => {
        const { panes, activePane } = get();
        const p = panes[activePane];
        let i = p.historyIndex - 1;
        while (i >= 0 && !p.tabs.some((t) => t.id === p.history[i])) i--;
        if (i < 0) return;
        const idx = i;
        set({
          panes: panes.map((pane, j) =>
            j === activePane ? { ...pane, activeTabId: pane.history[idx], historyIndex: idx } : pane,
          ),
        });
      },

      navigateForward: () => {
        const { panes, activePane } = get();
        const p = panes[activePane];
        let i = p.historyIndex + 1;
        while (i < p.history.length && !p.tabs.some((t) => t.id === p.history[i])) i++;
        if (i >= p.history.length) return;
        const idx = i;
        set({
          panes: panes.map((pane, j) =>
            j === activePane ? { ...pane, activeTabId: pane.history[idx], historyIndex: idx } : pane,
          ),
        });
      },
      toggleLeftSidebar: () => set({ leftSidebarOpen: !get().leftSidebarOpen }),
      toggleRightSidebar: () => set({ rightSidebarOpen: !get().rightSidebarOpen }),
      setRightPane: (pane) => set({ rightPane: pane }),
      toggleRibbon: () => set({ ribbonVisible: !get().ribbonVisible }),
      setLeftWidth: (w) => set({ leftWidth: Math.min(Math.max(w, 200), 480) }),
      setRightWidth: (w) => set({ rightWidth: Math.min(Math.max(w, 220), 520) }),
      setSplitRatio: (r) => set({ splitRatio: Math.min(Math.max(r, 0.2), 0.8) }),
      setDragging: (d) => set({ dragging: d }),

      reorderTab: (tabId, paneIndex, toIndex) => {
        set({
          panes: get().panes.map((p, i) => {
            if (i !== paneIndex) return p;
            const from = p.tabs.findIndex((t) => t.id === tabId);
            if (from < 0) return p;
            const tabs = [...p.tabs];
            const [moved] = tabs.splice(from, 1);
            tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, moved);
            return { ...p, tabs: sortPinned(tabs) };
          }),
        });
      },

      moveTabToPane: (tabId, fromPaneIndex, toPaneIndex, toIndex) => {
        const { panes } = get();
        const src = panes[fromPaneIndex];
        const tab = src?.tabs.find((t) => t.id === tabId);
        if (!tab) return;
        if (fromPaneIndex === toPaneIndex) {
          get().reorderTab(tabId, fromPaneIndex, toIndex);
          return;
        }
        const mapped = panes.map((p, i) => {
          if (i === fromPaneIndex) {
            const idx = p.tabs.findIndex((t) => t.id === tabId);
            const remaining = p.tabs.filter((t) => t.id !== tabId);
            const activeTabId =
              p.activeTabId === tabId
                ? (remaining[idx]?.id ?? remaining[idx - 1]?.id ?? null)
                : p.activeTabId;
            return { ...p, tabs: remaining, activeTabId };
          }
          if (i === toPaneIndex) {
            const tabs = [...p.tabs];
            tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
            return { ...p, tabs: sortPinned(tabs), activeTabId: tab.id, ...recorded(p, tab.id) };
          }
          return p;
        });
        // an emptied non-first pane disappears
        const kept = mapped.filter((p, i) => i === 0 || p.tabs.length > 0);
        const activePane = Math.max(
          0,
          kept.findIndex((p) => p.tabs.some((t) => t.id === tabId)),
        );
        set({ panes: kept, activePane });
      },

      splitWithTab: (tabId, fromPaneIndex, edge) => {
        const { panes } = get();
        const src = panes[fromPaneIndex];
        const tab = src?.tabs.find((t) => t.id === tabId);
        if (!tab) return;
        const orientation = edge === "left" || edge === "right" ? "row" : "column";
        // Two panes already: the flat model can't nest, so just move across.
        if (panes.length >= 2) {
          get().moveTabToPane(tabId, fromPaneIndex, fromPaneIndex === 0 ? 1 : 0, panes[fromPaneIndex === 0 ? 1 : 0].tabs.length);
          set({ splitOrientation: orientation });
          return;
        }
        // Moving the only tab into a new pane would just re-collapse — no-op.
        if (src.tabs.length <= 1) return;
        const idx = src.tabs.findIndex((t) => t.id === tabId);
        const remaining = src.tabs.filter((t) => t.id !== tabId);
        const oldPane: PaneState = {
          ...src,
          tabs: remaining,
          activeTabId:
            src.activeTabId === tabId ? (remaining[idx]?.id ?? remaining[idx - 1]?.id ?? null) : src.activeTabId,
        };
        const newPane: PaneState = {
          tabs: [tab],
          activeTabId: tab.id,
          history: [tab.id],
          historyIndex: 0,
        };
        const before = edge === "left" || edge === "top";
        set({
          panes: before ? [newPane, oldPane] : [oldPane, newPane],
          splitOrientation: orientation,
          activePane: before ? 0 : 1,
        });
      },
      setEditorMode: (mode) => set({ editorMode: mode }),
      setDefaultEditorMode: (mode) => set({ defaultEditorMode: mode }),
      setExplorerSort: (sort) => set({ explorerSort: sort }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setSwitcherOpen: (open) => set({ switcherOpen: open }),
      setVersionsOpen: (open) => set({ versionsOpen: open }),
      setLeftPane: (pane) => set({ leftPane: pane }),
      setSearchSeed: (q) => set({ searchSeed: q }),
    }),
    {
      name: "nodum-workspace",
      version: 3,
      migrate: (persisted: unknown) => {
        const old = persisted as {
          tabs?: Tab[];
          activeTabId?: string | null;
          panes?: Partial<PaneState>[];
        } & Record<string, unknown>;
        if (!old.panes && old.tabs) {
          old.panes = [{ tabs: old.tabs, activeTabId: old.activeTabId ?? null }];
          old.activePane = 0;
        }
        // v2 panes lack history fields
        old.panes = (old.panes ?? []).map((p) => ({
          tabs: p.tabs ?? [],
          activeTabId: p.activeTabId ?? null,
          history: p.history ?? (p.activeTabId ? [p.activeTabId] : []),
          historyIndex: p.historyIndex ?? (p.activeTabId ? 0 : -1),
        }));
        return old;
      },
      partialize: (s) => ({
        activeVaultId: s.activeVaultId,
        panes: s.panes,
        activePane: s.activePane,
        leftSidebarOpen: s.leftSidebarOpen,
        rightSidebarOpen: s.rightSidebarOpen,
        ribbonVisible: s.ribbonVisible,
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        splitRatio: s.splitRatio,
        splitOrientation: s.splitOrientation,
        editorMode: s.editorMode,
        explorerSort: s.explorerSort,
      }),
    },
  ),
);
