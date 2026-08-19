"use client";

/**
 * Workspace UI state — open tabs, sidebars, active view.
 * Server data (notes, tree, graph) lives in react-query; this store only
 * holds layout/UI state, persisted per browser.
 */

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

const STORAGE_KEY = "nodum-workspace";

export type MainView =
  | { kind: "note"; noteId: string }
  | { kind: "graph" }
  | { kind: "empty" };

export type EditorMode = "live" | "source" | "reading";

/** Right-sidebar panels (mirrors sidebar-right.tsx). */
export type RightPaneKind = "backlinks" | "outgoing" | "tags" | "outline" | "local-graph" | "ai";

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
  /** Where this pane has been (⌘[ / ⌘]). Whole tabs, not ids: following a link
   *  navigates IN PLACE, so the tab you came from is no longer open and Back
   *  has to be able to put it back. */
  history: Tab[];
  historyIndex: number;
}

const emptyPane = (): PaneState => ({ tabs: [], activeTabId: null, history: [], historyIndex: -1 });

/** Pinned first, original order otherwise. */
function sortPinned(tabs: Tab[]): Tab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

/** The history index reached by stepping `dir`. null when there is nowhere to
 *  go — which is exactly what the back/forward buttons use to disable
 *  themselves. Entries are never skipped: one whose tab is no longer open is
 *  re-opened in place, the way a browser goes back to a page you left. */
export function historyStep(p: PaneState, dir: 1 | -1): number | null {
  const i = p.historyIndex + dir;
  if (i < 0 || i >= p.history.length) return null;
  return i;
}

/** Show a history entry in a pane: activate its tab if it is still open,
 *  otherwise put it back where the current tab is (a pinned tab is never
 *  displaced — the entry opens beside it instead). */
function shownAt(p: PaneState, index: number): PaneState {
  const entry = p.history[index];
  if (!entry) return p;
  if (p.tabs.some((t) => t.id === entry.id)) {
    return { ...p, activeTabId: entry.id, historyIndex: index };
  }
  const at = p.tabs.findIndex((t) => t.id === p.activeTabId);
  const tabs = [...p.tabs];
  if (at >= 0 && !tabs[at].pinned) tabs.splice(at, 1, entry);
  else tabs.push(entry);
  return { ...p, tabs: sortPinned(tabs), activeTabId: entry.id, historyIndex: index };
}

/** Rebuild a pane's history after tabs were CLOSED.
 *  Only the closed tabs' own entries go — everything else is still reachable.
 *  Without this, historyIndex keeps pointing past the tab you are actually on,
 *  so the first Back press appears to do nothing and later ones jump several
 *  notes at once. */
function syncedHistory(
  p: PaneState,
  closedIds: Set<string>,
  activeTabId: string | null,
): Pick<PaneState, "history" | "historyIndex"> {
  const history: Tab[] = [];
  let historyIndex = -1;
  p.history.forEach((entry, i) => {
    if (closedIds.has(entry.id) || history.at(-1)?.id === entry.id) return;
    history.push(entry);
    if (i <= p.historyIndex) historyIndex = history.length - 1;
  });
  // Keep the cursor on the tab that is actually showing.
  if (activeTabId) {
    const at = history.findLastIndex((t) => t.id === activeTabId);
    if (at >= 0) historyIndex = at;
    else {
      const tab = p.tabs.find((t) => t.id === activeTabId);
      if (tab) {
        history.push(tab);
        historyIndex = history.length - 1;
      }
    }
  }
  return { history, historyIndex };
}

/** The pane's tabs after opening `tab`.
 *  `replace` is link-following: the note takes over the tab you were reading in
 *  (Obsidian's behaviour, and the reason ⌘-click exists) rather than piling up
 *  a tab per link. A pinned tab is never taken over, and a tab that is already
 *  open is simply activated. */
function openedTabs(p: PaneState, tab: Tab, replace: boolean): Tab[] {
  if (p.tabs.some((t) => t.id === tab.id)) return p.tabs;
  if (replace) {
    const at = p.tabs.findIndex((t) => t.id === p.activeTabId);
    if (at >= 0 && !p.tabs[at].pinned) {
      const tabs = [...p.tabs];
      tabs.splice(at, 1, tab);
      return sortPinned(tabs);
    }
  }
  return sortPinned([...p.tabs, tab]);
}

/** Append to a pane's history (truncating any forward entries). */
function recorded(p: PaneState, tab: Tab): Pick<PaneState, "history" | "historyIndex"> {
  if (p.history[p.historyIndex]?.id === tab.id) {
    return { history: p.history, historyIndex: p.historyIndex };
  }
  const history = [...p.history.slice(0, p.historyIndex + 1), tab].slice(-50);
  return { history, historyIndex: history.length - 1 };
}

// ── Persistence: one record, partitioned by vault ────────────────────────────
//
// A vault is a whole separate workspace, and switching to one opens a NEW
// BROWSER TAB — so two tabs, on two vaults, write this record at the same time.
// Storing a single `panes` array meant last-write-wins: the vault you were not
// touching lost its open tabs. Layouts are therefore keyed by vault id, and
// every write RE-READS the record and replaces only this tab's own vault.
//
// Which vault a tab belongs to comes from the URL (/vault/<id>), not from the
// store: the URL is the one thing that is genuinely per-tab.

interface StoredLayout {
  panes: PaneState[];
  activePane: number;
}

/** The on-disk shape: shared chrome + one layout per vault. */
type StoredState = Omit<Persisted, "panes" | "activePane"> & {
  layouts?: Record<string, StoredLayout>;
};

function vaultIdFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const match = /^\/vault\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function readRecord(): { state?: StoredState; version?: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { state?: StoredState; version?: number }) : null;
  } catch {
    return null; // private mode, quota, corrupted JSON — start clean
  }
}

/** This vault's last layout, straight from storage — used when a single tab
 *  changes vault (the dispatcher) without a reload. */
function readStoredLayout(vaultId: string): StoredLayout | null {
  return readRecord()?.state?.layouts?.[vaultId] ?? null;
}

const vaultScopedStorage: PersistStorage<Persisted> = {
  getItem: (): StorageValue<Persisted> | null => {
    const record = readRecord();
    if (!record?.state) return null;
    const state = record.state;
    const vaultId = vaultIdFromPath() ?? state.activeVaultId ?? null;
    const layout = vaultId ? state.layouts?.[vaultId] : undefined;
    // No layouts map = written by a build before this one. Its top-level panes
    // belong to whatever vault was active then; adopt them only for that vault.
    const legacy =
      state.layouts === undefined && vaultId && vaultId === state.activeVaultId
        ? ((state as unknown as Persisted).panes ?? null)
        : null;
    return {
      version: record.version,
      state: {
        ...(state as unknown as Persisted),
        // The in-memory panes and activeVaultId must always agree: setItem
        // files panes under activeVaultId, so hydrating B's layout while
        // claiming to be A would write B's tabs over A's on the first change.
        activeVaultId: vaultId,
        // Never []: the workspace indexes panes[activePane] on first render.
        panes: layout?.panes ?? legacy ?? [emptyPane()],
        activePane: layout?.activePane ?? 0,
      },
    };
  },
  setItem: (_name, value) => {
    if (typeof window === "undefined") return;
    const { panes, activePane, ...chrome } = value.state;
    // Keyed by the vault the in-memory panes BELONG to — not by the URL. On a
    // client-side move from vault A to vault B, child effects write to the
    // store before the page's setActiveVault runs; keying by URL then filed
    // A's tabs under B and B "restored" a layout it never had.
    const vaultId = value.state.activeVaultId ?? null;
    // Re-read rather than trusting what we last wrote: the other tab may have
    // saved its own vault's layout since.
    const layouts = { ...(readRecord()?.state?.layouts ?? {}) };
    if (vaultId) layouts[vaultId] = { panes, activePane };
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state: { ...chrome, layouts }, version: value.version }),
      );
    } catch {
      /* storage full or blocked — the layout is a convenience, not data */
    }
  },
  removeItem: () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  },
};

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
  /** Note the graph should accent-highlight (the note being viewed); transient. */
  graphFocusNoteId: string | null;
  /** Explorer reveal request: {kind, id, nonce}. The nonce makes repeat
   *  reveals of the SAME item distinct events, so asking twice works. */
  revealTarget: { kind: "note" | "folder"; id: string; nonce: number } | null;
  editorMode: EditorMode;
  /** User's "default view for new tabs" pref (runtime mirror, not persisted). */
  defaultEditorMode: EditorMode;
  explorerSort: ExplorerSort;
  paletteOpen: boolean;
  switcherOpen: boolean;
  versionsOpen: boolean;
  /** Settings dialog, in the store so any panel can send you to a tab of it
   *  (the vault switcher's "Manage vaults…", the AI panel's "set this up"). */
  settingsOpen: boolean;
  settingsTab: string | null;
  /** The onboarding tour, re-opened on request (first run opens it itself). */
  tourOpen: boolean;
  leftPane: "files" | "search" | "bookmarks";
  /** One-shot query seed for the search pane (tag pane click-to-search). */
  searchSeed: string | null;

  setActiveVault: (vaultId: string | null) => void;
  /** adoptDefaultMode=false: in-editor link navigation keeps the current view mode.
   *  replace=true: show it in the CURRENT tab instead of opening another one
   *  (following a link); a pinned tab is never displaced. */
  openTab: (tab: Tab, opts?: { adoptDefaultMode?: boolean; replace?: boolean }) => void;
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
  /** Open a tab in the pane beside `fromPaneIndex` (splitting if there's one pane). */
  openNoteBeside: (tab: Tab, fromPaneIndex: number) => void;
  closePane: (index: number) => void;
  togglePin: (tabId: string, paneIndex: number) => void;
  /** paneIndex omitted → the active pane (⌘[ / ⌘]); the arrows pass their own. */
  navigateBack: (paneIndex?: number) => void;
  navigateForward: (paneIndex?: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setRightPane: (pane: RightPaneKind) => void;
  toggleRibbon: () => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setSplitRatio: (ratio: number) => void;
  setDragging: (d: { tabId: string; fromPaneIndex: number } | null) => void;
  setGraphFocus: (noteId: string | null) => void;
  /** Expand the path to a note and scroll it into view in the file explorer. */
  revealNote: (noteId: string) => void;
  /** Same, for a folder. */
  revealFolder: (folderId: string) => void;
  setSplitOrientation: (orientation: "row" | "column") => void;
  /** Sign-out hygiene: forget which vault was open and close every transient
   *  overlay, so the next account (same browser) starts clean. */
  resetForSignOut: () => void;
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
  /** Open settings, optionally straight to a named tab. */
  openSettings: (tab?: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setTourOpen: (open: boolean) => void;
  setLeftPane: (pane: "files" | "search" | "bookmarks") => void;
  setSearchSeed: (q: string | null) => void;
}

/** Exactly what `partialize` keeps. `panes`/`activePane` are the ACTIVE vault's;
 *  the storage adapter above files them under that vault on the way out. */
type Persisted = Pick<
  WorkspaceState,
  | "activeVaultId"
  | "panes"
  | "activePane"
  | "leftSidebarOpen"
  | "rightSidebarOpen"
  | "ribbonVisible"
  | "leftWidth"
  | "rightWidth"
  | "splitRatio"
  | "splitOrientation"
  | "editorMode"
  | "explorerSort"
>;

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
      graphFocusNoteId: null,
      revealTarget: null,
      editorMode: "live",
      defaultEditorMode: "live",
      explorerSort: "title-asc",
      paletteOpen: false,
      switcherOpen: false,
      versionsOpen: false,
      settingsOpen: false,
      settingsTab: null,
      tourOpen: false,
      leftPane: "files",
      searchSeed: null,

      setActiveVault: (vaultId) => {
        if (get().activeVaultId === vaultId) return;
        // A vault is a whole separate workspace: swap in the layout this vault
        // was last left in rather than wiping the tab strip. Everything else
        // held here refers to notes BY ID, so it is meaningless in the new
        // vault and has to go with the old one.
        const layout = vaultId ? readStoredLayout(vaultId) : null;
        set({
          activeVaultId: vaultId,
          panes: layout?.panes ?? [emptyPane()],
          activePane: layout?.activePane ?? 0,
          graphFocusNoteId: null,
          revealTarget: null,
          searchSeed: null,
        });
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
                  tabs: openedTabs(p, tab, opts?.replace ?? false),
                  activeTabId: tab.id,
                  ...recorded(p, tab),
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
          // Drop the closed tab from history too: closing is the one way to say
          // "I am done with this note", so Back must not resurrect it.
          return {
            ...p,
            tabs: remaining,
            activeTabId,
            ...syncedHistory(p, new Set([tabId]), activeTabId),
          };
        });
        // a second pane that runs out of tabs disappears
        const kept = panes.filter((p, i) => i === 0 || p.tabs.length > 0);
        set({ panes: kept, activePane: Math.min(get().activePane, kept.length - 1) });
      },

      closeOtherTabs: () => {
        const { panes, activePane } = get();
        set({
          panes: panes.map((p, i) => {
            if (i !== activePane) return p;
            const tabs = p.tabs.filter((t) => t.id === p.activeTabId || t.pinned);
            const closed = new Set(
              p.tabs.filter((t) => !tabs.includes(t)).map((t) => t.id),
            );
            // Prune history too, else Back stays enabled and goes nowhere.
            return { ...p, tabs, ...syncedHistory(p, closed, p.activeTabId) };
          }),
        });
      },

      setActiveTab: (tabId, paneIndex) => {
        const { panes, activePane } = get();
        const target =
          paneIndex ?? panes.findIndex((p) => p.tabs.some((t) => t.id === tabId));
        const index = target === -1 ? activePane : target;
        set({
          panes: panes.map((p, i) => {
            if (i !== index) return p;
            const tab = p.tabs.find((t) => t.id === tabId);
            return { ...p, activeTabId: tabId, ...(tab ? recorded(p, tab) : {}) };
          }),
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
            // History holds its own copies of the tab — rename those too, or
            // going back to a note you renamed would restore the old label.
            history: p.history.map((t) => (t.id === tabId ? { ...t, title } : t)),
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
            { tabs: [active], activeTabId: active.id, history: [active], historyIndex: 0 },
          ],
          activePane: panes.length,
        });
      },

      // Open a tab in the OTHER pane (Obsidian's "open in split"): keep the
      // source pane — the graph — where it is, and put the note beside it. With
      // one pane, create the second; with two, target the non-source pane.
      openNoteBeside: (tab, fromPaneIndex) => {
        const { panes, graphFocusNoteId } = get();
        const focus = tab.kind === "note" ? tab.id : graphFocusNoteId;
        if (panes.length >= 2) {
          const target = fromPaneIndex === 0 ? 1 : 0;
          set({
            panes: panes.map((p, i) =>
              i === target
                ? {
                    ...p,
                    tabs: p.tabs.some((t) => t.id === tab.id)
                      ? p.tabs
                      : sortPinned([...p.tabs, tab]),
                    activeTabId: tab.id,
                    ...recorded(p, tab),
                  }
                : p,
            ),
            activePane: target,
            graphFocusNoteId: focus,
          });
        } else {
          set({
            panes: [
              panes[0],
              { tabs: [tab], activeTabId: tab.id, history: [tab], historyIndex: 0 },
            ],
            activePane: 1,
            graphFocusNoteId: focus,
          });
        }
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

      // ⌘[ / ⌘] and the per-pane arrows — walk where this pane has been. An
      // entry whose tab was navigated away in place is re-opened in place.
      // paneIndex defaults to the active pane.
      navigateBack: (paneIndex) => {
        const { panes, activePane } = get();
        const target = paneIndex ?? activePane;
        const p = panes[target];
        if (!p) return;
        const idx = historyStep(p, -1);
        if (idx === null) return;
        set({ panes: panes.map((pane, j) => (j === target ? shownAt(pane, idx) : pane)) });
      },

      navigateForward: (paneIndex) => {
        const { panes, activePane } = get();
        const target = paneIndex ?? activePane;
        const p = panes[target];
        if (!p) return;
        const idx = historyStep(p, 1);
        if (idx === null) return;
        set({ panes: panes.map((pane, j) => (j === target ? shownAt(pane, idx) : pane)) });
      },
      toggleLeftSidebar: () => set({ leftSidebarOpen: !get().leftSidebarOpen }),
      toggleRightSidebar: () => set({ rightSidebarOpen: !get().rightSidebarOpen }),
      setRightPane: (pane) => set({ rightPane: pane }),
      toggleRibbon: () => set({ ribbonVisible: !get().ribbonVisible }),
      setLeftWidth: (w) => set({ leftWidth: Math.min(Math.max(w, 200), 480) }),
      setRightWidth: (w) => set({ rightWidth: Math.min(Math.max(w, 220), 520) }),
      setSplitRatio: (r) => set({ splitRatio: Math.min(Math.max(r, 0.2), 0.8) }),
      setDragging: (d) => set({ dragging: d }),
      setGraphFocus: (noteId) => set({ graphFocusNoteId: noteId }),
      // The nonce is what makes a repeat reveal of the same item a NEW event;
      // without it the explorer sees an unchanged value and does nothing.
      revealNote: (noteId) =>
        set({ revealTarget: { kind: "note", id: noteId, nonce: (get().revealTarget?.nonce ?? 0) + 1 } }),
      revealFolder: (folderId) =>
        set({ revealTarget: { kind: "folder", id: folderId, nonce: (get().revealTarget?.nonce ?? 0) + 1 } }),
      setSplitOrientation: (orientation) => set({ splitOrientation: orientation }),
      resetForSignOut: () =>
        set({
          activeVaultId: null,
          panes: [emptyPane()],
          activePane: 0,
          settingsOpen: false,
          settingsTab: null,
          paletteOpen: false,
          switcherOpen: false,
          versionsOpen: false,
          tourOpen: false,
          searchSeed: null,
          graphFocusNoteId: null,
          revealTarget: null,
        }),

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
            // The tab left this pane — drop it from this pane's history as well.
            return {
              ...p,
              tabs: remaining,
              activeTabId,
              ...syncedHistory(p, new Set([tabId]), activeTabId),
            };
          }
          if (i === toPaneIndex) {
            // Dedupe: the same note/graph/canvas may already be open here —
            // never insert a second tab with the same id (React key collision).
            const tabs = p.tabs.filter((t) => t.id !== tabId);
            tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
            return { ...p, tabs: sortPinned(tabs), activeTabId: tab.id, ...recorded(p, tab) };
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
          history: [tab],
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
      openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? null }),
      setSettingsOpen: (open) => set({ settingsOpen: open, settingsTab: open ? get().settingsTab : null }),
      setTourOpen: (open) => set({ tourOpen: open }),
      setLeftPane: (pane) => set({ leftPane: pane }),
      setSearchSeed: (q) => set({ searchSeed: q }),
    }),
    {
      name: STORAGE_KEY,
      storage: vaultScopedStorage,
      version: 5,
      migrate: (persisted: unknown) => {
        const old = persisted as {
          tabs?: Tab[];
          activeTabId?: string | null;
          panes?: (Partial<PaneState> & { history?: (Tab | string)[] })[];
        } & Record<string, unknown>;
        if (!old.panes && old.tabs) {
          old.panes = [{ tabs: old.tabs, activeTabId: old.activeTabId ?? null }];
          old.activePane = 0;
        }
        // v2 panes lack history fields; v3 stored history as tab ids — resolve
        // them against the pane's tabs and drop the ones that no longer exist.
        old.panes = (old.panes ?? []).map((p) => {
          const tabs = p.tabs ?? [];
          const active = tabs.find((t) => t.id === p.activeTabId);
          const raw = p.history ?? (active ? [active] : []);
          const history = raw
            .map((entry) => (typeof entry === "string" ? tabs.find((t) => t.id === entry) : entry))
            .filter((entry): entry is Tab => Boolean(entry));
          return {
            tabs,
            activeTabId: p.activeTabId ?? null,
            history,
            historyIndex: Math.min(p.historyIndex ?? history.length - 1, history.length - 1),
          };
        });
        return old as unknown as Persisted;
      },
      // Defensive on EVERY load: a pane must never hold two tabs with the same
      // id (React key collision → render crash). Older builds could persist a
      // duplicate; this drops the extras, keeping the first.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkspaceState>;
        const rawPanes = p.panes && p.panes.length > 0 ? p.panes : current.panes;
        const panes = rawPanes.map((pane) => {
          const seen = new Set<string>();
          const tabs = (pane.tabs ?? []).filter((t) => {
            if (!t || seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          });
          // History holds whole tabs since v4; a layout written by an older
          // build (or half-migrated) would hold bare ids, which Back would then
          // try to render as a tab. Drop anything that is not a tab.
          const history = (pane.history ?? []).filter(
            (entry): entry is Tab => Boolean(entry) && typeof entry === "object" && "id" in entry,
          );
          const historyIndex = Math.min(pane.historyIndex ?? -1, history.length - 1);
          return { ...pane, tabs, history, historyIndex };
        });
        return { ...current, ...p, panes };
      },
      partialize: (s): Persisted => ({
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
