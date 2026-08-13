"use client";

/** Workspace — the Obsidian-style application frame. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { EditorPane } from "./editor-pane";

// WebGL2 + 144kB gz — never in the shared bundle, never SSR'd.
const GraphView = dynamic(
  () => import("@/components/graph/graph-view").then((m) => m.GraphView),
  { ssr: false, loading: () => <GraphLoading /> },
);

function GraphLoading() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-ob-faint">
      Loading graph…
    </div>
  );
}
import { CommandPalette } from "./command-palette";
import { QuickSwitcher } from "./quick-switcher";
import { Ribbon } from "./ribbon";
import { SettingsModal } from "./settings-modal";
import { SidebarLeft } from "./sidebar-left";
import { SidebarRight } from "./sidebar-right";
import { StatusBar } from "./status-bar";
import { TabBar } from "./tab-bar";
import { CanvasView } from "@/components/canvas/canvas-view";
import { TemplatePicker } from "./template-picker";
import { Toaster } from "./toaster";
import { dailyApi, noteApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { Menu, PanelRight } from "lucide-react";

import { ConfirmDialog, confirmDelete } from "./confirm-dialog";
import { useEditorSettings, useUserPrefs } from "@/lib/hooks/use-editor-settings";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { resolveNewNoteFolder } from "@/lib/new-note-location";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function Workspace({ vault }: { vault: Vault }) {
  const queryClient = useQueryClient();
  const panes = useWorkspaceStore((s) => s.panes);
  const activePane = useWorkspaceStore((s) => s.activePane);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const setSwitcherOpen = useWorkspaceStore((s) => s.setSwitcherOpen);
  const switcherOpen = useWorkspaceStore((s) => s.switcherOpen);

  const isMobile = useIsMobile();
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  // Mirror the user's "default view for new tabs" pref into the store so
  // openTab can apply it without reaching into React state.
  const defaultViewMode = useEditorSettings().defaultViewMode;
  useEffect(() => {
    useWorkspaceStore.getState().setDefaultEditorMode(defaultViewMode);
  }, [defaultViewMode]);

  // Accent colour override (S11.3) — applied on boot and live on change.
  const accentColor = useUserPrefs().accentColor;
  useEffect(() => {
    const root = document.documentElement;
    if (accentColor) {
      root.style.setProperty("--ob-interactive-accent", accentColor);
      root.style.setProperty(
        "--ob-interactive-accent-hover",
        `color-mix(in srgb, ${accentColor} 85%, white)`,
      );
    } else {
      root.style.removeProperty("--ob-interactive-accent");
      root.style.removeProperty("--ob-interactive-accent-hover");
    }
    return () => {
      root.style.removeProperty("--ob-interactive-accent");
      root.style.removeProperty("--ob-interactive-accent-hover");
    };
  }, [accentColor]);
  const currentPane = panes[activePane] ?? panes[0];
  const activeTab = currentPane.tabs.find((t) => t.id === currentPane.activeTabId) ?? null;
  const activeNoteId = activeTab?.kind === "note" ? activeTab.id : null;

  const openNote = useCallback(
    (noteId: string, title: string) => {
      openTab({ id: noteId, kind: "note", title });
      setMobileLeftOpen(false);
      setMobileRightOpen(false);
    },
    [openTab],
  );

  const openGraph = useCallback(() => {
    openTab({ id: "graph", kind: "graph", title: "Graph view" });
  }, [openTab]);

  const createFromGraph = useCallback(
    (title: string) => {
      void (async () => {
        try {
          const created = await noteApi.create(vault.id, {
            title,
            folder_path: resolveNewNoteFolder(queryClient, vault.id),
          });
          void queryClient.invalidateQueries({ queryKey: ["tree", vault.id] });
          void queryClient.invalidateQueries({ queryKey: ["graph", vault.id] });
          openNote(created.id, created.title);
        } catch (err) {
          toastError(err, "Could not create note.");
        }
      })();
    },
    [vault.id, queryClient, openNote],
  );

  const newNote = useMutation({
    mutationFn: () => {
      const stamp = new Date();
      const title = `Untitled ${stamp.toISOString().slice(0, 16).replace("T", " ")}`;
      return noteApi.create(vault.id, {
        title,
        folder_path: resolveNewNoteFolder(queryClient, vault.id),
      });
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["tree", vault.id] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vault.id] });
      openNote(note.id, note.title);
    },
  });

  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const exportVault = useCallback(() => {
    // Same-origin proxy carries the cookie; access token not needed for a download
    window.open(`/api/v1/vaults/${vault.id}/export`, "_blank");
  }, [vault.id]);

  const importVault = useCallback(
    (file: File) => {
      void (async () => {
        try {
          const form = new FormData();
          form.append("file", file);
          const stats = await api<{ imported: number; renamed: number }>(
            `/vaults/${vault.id}/import`,
            { method: "POST", body: form },
          );
          void queryClient.invalidateQueries({ queryKey: ["tree", vault.id] });
          void queryClient.invalidateQueries({ queryKey: ["graph", vault.id] });
          void queryClient.invalidateQueries({ queryKey: ["tags", vault.id] });
          useToastStore.getState().push(
            `Imported ${String(stats.imported)} notes` +
              (stats.renamed ? ` (${String(stats.renamed)} renamed)` : ""),
            "info",
          );
        } catch (err) {
          toastError(err, "Import failed.");
        }
      })();
    },
    [vault.id, queryClient],
  );

  const openDailyNote = useCallback(() => {
    void (async () => {
      try {
        const note = await dailyApi.openDailyNote(vault.id);
        void queryClient.invalidateQueries({ queryKey: ["tree", vault.id] });
        void queryClient.invalidateQueries({ queryKey: ["graph", vault.id] });
        openNote(note.id, note.title);
      } catch (err) {
        toastError(err, "Could not open today's daily note.");
      }
    })();
  }, [vault.id, queryClient, openNote]);

  const closeActiveTab = useCallback(() => {
    const { panes: all, activePane: idx } = useWorkspaceStore.getState();
    const current = all[idx]?.activeTabId;
    if (current) closeTab(current, idx);
  }, [closeTab]);

  const deleteActiveNote = useCallback(() => {
    const { panes: all, activePane: idx } = useWorkspaceStore.getState();
    const current = all[idx]?.activeTabId;
    const tab = all[idx]?.tabs.find((t) => t.id === current && t.kind === "note");
    if (!tab) return;
    void (async () => {
      try {
        if (!(await confirmDelete(`Delete “${tab.title}”?`))) return;
        await noteApi.remove(vault.id, tab.id);
        closeTab(tab.id);
        void queryClient.invalidateQueries({ queryKey: ["tree", vault.id] });
        void queryClient.invalidateQueries({ queryKey: ["graph", vault.id] });
      } catch (err) {
        toastError(err, "Could not delete note.");
      }
    })();
  }, [vault.id, closeTab, queryClient]);

  // Global hotkeys: ⌘O switcher, ⌘N new note, ⌘G graph
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "o") {
        e.preventDefault();
        setSwitcherOpen(!switcherOpen);
      } else if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        newNote.mutate();
      } else if (e.key === "g") {
        e.preventDefault();
        openGraph();
      } else if (e.key === "p") {
        e.preventDefault();
        useWorkspaceStore.getState().setPaletteOpen(true);
      } else if (e.key === "w") {
        e.preventDefault();
        closeActiveTab();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "e") {
        e.preventDefault();
        const { editorMode, setEditorMode } = useWorkspaceStore.getState();
        setEditorMode(editorMode === "reading" ? "live" : "reading");
      } else if (e.key === "\\") {
        e.preventDefault();
        useWorkspaceStore.getState().splitRight();
      } else if (e.key === "[") {
        e.preventDefault();
        useWorkspaceStore.getState().navigateBack();
      } else if (e.key === "]") {
        e.preventDefault();
        useWorkspaceStore.getState().navigateForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, switcherOpen, newNote, openGraph, closeActiveTab]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ob-sidebar text-ob-text md:flex-row">
      {/* Mobile top bar — hamburger, vault name, panels */}
      {isMobile && (
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-ob-border bg-ob-sidebar px-2 md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileLeftOpen(true)}
            className="flex size-10 items-center justify-center rounded-md text-ob-muted hover:bg-ob-hover"
          >
            <Menu className="size-5" strokeWidth={1.75} />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium">
            {vault.name}
          </span>
          <button
            type="button"
            aria-label="Open panels"
            onClick={() => setMobileRightOpen(true)}
            className="flex size-10 items-center justify-center rounded-md text-ob-muted hover:bg-ob-hover"
          >
            <PanelRight className="size-5" strokeWidth={1.75} />
          </button>
        </header>
      )}

      {!isMobile && (
        <Ribbon onNewNote={() => newNote.mutate()} onOpenGraph={openGraph} onOpenDailyNote={openDailyNote} />
      )}
      {!isMobile && (
        <SidebarLeft
          vaultId={vault.id}
          vaultName={vault.name}
          activeNoteId={activeNoteId}
          onOpenNote={openNote}
        />
      )}

      <main className="relative flex min-w-0 flex-1 border-l border-ob-border">
        {panes.map((pane, paneIndex) => {
          const paneTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
          return (
            <section
              key={paneIndex}
              aria-label={`Editor pane ${String(paneIndex + 1)}`}
              onFocusCapture={() => setActivePane(paneIndex)}
              onClickCapture={() => setActivePane(paneIndex)}
              className={
                paneIndex > 0
                  ? "flex min-w-0 flex-1 flex-col border-l border-ob-border"
                  : "flex min-w-0 flex-1 flex-col"
              }
            >
              <TabBar paneIndex={paneIndex} onNewNote={() => newNote.mutate()} />
              <div className="relative min-h-0 flex-1 bg-ob-bg">
                {paneTab === null && <EmptyState onNewNote={() => newNote.mutate()} />}
                {paneTab?.kind === "note" && (
                  <EditorPane vaultId={vault.id} noteId={paneTab.id} />
                )}
                {paneTab?.kind === "graph" && (
                  <GraphView
                    vaultId={vault.id}
                    onOpenNote={openNote}
                    onCreateNote={createFromGraph}
                  />
                )}
                {paneTab?.kind === "canvas" && (
                  <CanvasView vaultId={vault.id} canvasId={paneTab.id} />
                )}
                {paneIndex === panes.length - 1 && (
                  <StatusBar vaultId={vault.id} noteId={activeNoteId} />
                )}
              </div>
            </section>
          );
        })}
      </main>

      {!isMobile && (
        <SidebarRight vaultId={vault.id} noteId={activeNoteId} onOpenNote={openNote} />
      )}

      {/* Mobile drawers */}
      {isMobile && mobileLeftOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          role="presentation"
          onClick={() => setMobileLeftOpen(false)}
        >
          <div
            className="absolute top-0 left-0 h-full w-[85vw] max-w-[320px] shadow-2xl"
            role="dialog"
            aria-label="Navigation drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarLeft
              drawer
              vaultId={vault.id}
              vaultName={vault.name}
              activeNoteId={activeNoteId}
              onOpenNote={openNote}
            />
          </div>
        </div>
      )}
      {isMobile && mobileRightOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          role="presentation"
          onClick={() => setMobileRightOpen(false)}
        >
          <div
            className="absolute top-0 right-0 h-full w-[85vw] max-w-[320px] shadow-2xl"
            role="dialog"
            aria-label="Panels drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarRight drawer vaultId={vault.id} noteId={activeNoteId} onOpenNote={openNote} />
          </div>
        </div>
      )}

      <QuickSwitcher vaultId={vault.id} onOpenNote={openNote} />
      <CommandPalette
        onNewNote={() => newNote.mutate()}
        onOpenGraph={openGraph}
        onDeleteActiveNote={deleteActiveNote}
        onCloseActiveTab={closeActiveTab}
        onOpenDailyNote={openDailyNote}
        onInsertTemplate={() => setTemplatePickerOpen(true)}
        onExportVault={exportVault}
        onImportVault={() => importInputRef.current?.click()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsModal vaultId={vault.id} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConfirmDialog />
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importVault(file);
          e.target.value = "";
        }}
      />
      <TemplatePicker
        vaultId={vault.id}
        noteId={activeNoteId}
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
      />
      <Toaster />
    </div>
  );
}

function EmptyState({ onNewNote }: { onNewNote: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-[15px] text-ob-faint">No file is open</p>
      <button
        type="button"
        onClick={onNewNote}
        className="text-[13px] text-ob-accent hover:text-ob-accent-hover hover:underline"
      >
        Create new note (⌘N)
      </button>
      <button
        type="button"
        onClick={() => useWorkspaceStore.getState().setSwitcherOpen(true)}
        className="text-[13px] text-ob-accent hover:text-ob-accent-hover hover:underline"
      >
        Open quick switcher (⌘O)
      </button>
    </div>
  );
}
