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
import { SidebarLeft } from "./sidebar-left";
import { SidebarRight } from "./sidebar-right";
import { StatusBar } from "./status-bar";
import { TabBar } from "./tab-bar";
import { TemplatePicker } from "./template-picker";
import { Toaster } from "./toaster";
import { dailyApi, noteApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function Workspace({ vault }: { vault: Vault }) {
  const queryClient = useQueryClient();
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const setSwitcherOpen = useWorkspaceStore((s) => s.setSwitcherOpen);
  const switcherOpen = useWorkspaceStore((s) => s.switcherOpen);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeNoteId = activeTab?.kind === "note" ? activeTab.id : null;

  const openNote = useCallback(
    (noteId: string, title: string) => {
      openTab({ id: noteId, kind: "note", title });
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
          const created = await noteApi.create(vault.id, { title });
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
      return noteApi.create(vault.id, { title });
    },
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["tree", vault.id] });
      openNote(note.id, note.title);
    },
  });

  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
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
        openNote(note.id, note.title);
      } catch (err) {
        toastError(err, "Could not open today's daily note.");
      }
    })();
  }, [vault.id, queryClient, openNote]);

  const closeActiveTab = useCallback(() => {
    const { activeTabId: current } = useWorkspaceStore.getState();
    if (current) closeTab(current);
  }, [closeTab]);

  const deleteActiveNote = useCallback(() => {
    const { activeTabId: current, tabs: allTabs } = useWorkspaceStore.getState();
    const tab = allTabs.find((t) => t.id === current && t.kind === "note");
    if (!tab) return;
    void (async () => {
      try {
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
      } else if (e.key === "e") {
        e.preventDefault();
        const { editorMode, setEditorMode } = useWorkspaceStore.getState();
        setEditorMode(editorMode === "reading" ? "live" : "reading");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, switcherOpen, newNote, openGraph, closeActiveTab]);

  return (
    <div className="flex h-screen overflow-hidden bg-ob-sidebar text-ob-text">
      <Ribbon onNewNote={() => newNote.mutate()} onOpenGraph={openGraph} onOpenDailyNote={openDailyNote} />
      <SidebarLeft
        vaultId={vault.id}
        vaultName={vault.name}
        activeNoteId={activeNoteId}
        onOpenNote={openNote}
      />

      <main className="relative flex min-w-0 flex-1 flex-col border-l border-ob-border">
        <TabBar onNewNote={() => newNote.mutate()} />
        <div className="relative min-h-0 flex-1 bg-ob-bg">
          {activeTab === null && <EmptyState onNewNote={() => newNote.mutate()} />}
          {activeTab?.kind === "note" && <EditorPane vaultId={vault.id} noteId={activeTab.id} />}
          {activeTab?.kind === "graph" && (
            <GraphView vaultId={vault.id} onOpenNote={openNote} onCreateNote={createFromGraph} />
          )}
          <StatusBar vaultId={vault.id} noteId={activeNoteId} />
        </div>
      </main>

      <SidebarRight vaultId={vault.id} noteId={activeNoteId} onOpenNote={openNote} />
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
      />
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
