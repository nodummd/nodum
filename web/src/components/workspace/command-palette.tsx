"use client";

/** Command palette (⌘P) — Obsidian's every-action-searchable dialog. */

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ApiError } from "@/lib/api/client";
import { authApi, bookmarkApi, canvasApi, folderApi, noteApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";
import {
  EDITOR_SETTING_DEFAULTS,
  parseEditorSettings,
  parseUserPrefs,
} from "@/lib/hooks/use-editor-settings";
import { resolveNewNoteFolder } from "@/lib/new-note-location";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import type { PluginCommand } from "@/lib/plugins/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export interface PaletteCommand {
  id: string;
  label: string;
  hotkey?: string;
  run: () => void | Promise<void>;
  /** Only shown when a note tab is active. */
  needsNote?: boolean;
  /** Only shown when any tab is open. */
  needsTab?: boolean;
}

interface CommandPaletteProps {
  vaultId: string;
  onNewNote: () => void;
  onOpenGraph: () => void;
  onDeleteActiveNote: () => void;
  onCloseActiveTab: () => void;
  onOpenDailyNote: () => void;
  onInsertTemplate: () => void;
  onExportVault: () => void;
  onImportVault: () => void;
  onImportFolder: () => void;
  /** Commands contributed by enabled plugins. */
  pluginCommands: PluginCommand[];
  onRunPluginCommand: (pluginId: string, commandId: string) => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  vaultId,
  onNewNote,
  onOpenGraph,
  onDeleteActiveNote,
  onCloseActiveTab,
  onOpenDailyNote,
  onInsertTemplate,
  onExportVault,
  onImportVault,
  onImportFolder,
  pluginCommands,
  onRunPluginCommand,
  onOpenSettings,
}: CommandPaletteProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = useWorkspaceStore((s) => s.paletteOpen);
  const setOpen = useWorkspaceStore((s) => s.setPaletteOpen);
  const setSwitcherOpen = useWorkspaceStore((s) => s.setSwitcherOpen);
  const setVersionsOpen = useWorkspaceStore((s) => s.setVersionsOpen);
  const setMode = useWorkspaceStore((s) => s.setEditorMode);
  const toggleLeft = useWorkspaceStore((s) => s.toggleLeftSidebar);
  const toggleRight = useWorkspaceStore((s) => s.toggleRightSidebar);
  const panes = useWorkspaceStore((s) => s.panes);
  const activePane = useWorkspaceStore((s) => s.activePane);
  const tabs = panes[activePane]?.tabs ?? [];
  const activeTabId = panes[activePane]?.activeTabId ?? null;
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const toast = useToastStore((s) => s.push);

  const hasActiveNote = tabs.some((t) => t.id === activeTabId && t.kind === "note");
  const hasTab = activeTabId !== null;
  const editorPrefs = parseEditorSettings(user?.settings);

  // Optimistic user-setting toggle (editor prefs are read live from the store).
  const toggleSetting = (patch: Record<string, unknown>) => {
    const current = useAuthStore.getState().user;
    if (current) setUser({ ...current, settings: { ...current.settings, ...patch } });
    authApi.updateMe({ settings: patch }).catch((e) => toastError(e, "Could not save setting."));
  };

  // Wrap an async command so a rejection surfaces as a toast, never unhandled.
  const guard = (fn: () => Promise<void>) => () => {
    void fn().catch((e) => toastError(e, "Could not run that command."));
  };

  const activeNote = async (): Promise<Note | null> => {
    if (!activeTabId) return null;
    return (
      queryClient.getQueryData<Note>(["note", vaultId, activeTabId]) ??
      (await noteApi.get(vaultId, activeTabId))
    );
  };

  const openNoteTab = (note: { id: string; title: string }) =>
    useWorkspaceStore.getState().openTab({ id: note.id, kind: "note", title: note.title });

  const duplicateNote = async () => {
    const note = await activeNote();
    if (!note) return;
    // create_note rejects colliding paths — walk "copy", "copy 2", … until free
    for (let i = 1; i <= 25; i++) {
      const title = i === 1 ? `${note.title} copy` : `${note.title} copy ${i}`;
      try {
        const created = await noteApi.create(vaultId, {
          title,
          folder_id: note.folder_id ?? undefined,
          content: note.content,
        });
        void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
        void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
        openNoteTab(created);
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) continue;
        throw e;
      }
    }
  };

  const copyNotePath = async () => {
    const note = await activeNote();
    if (!note) return;
    await navigator.clipboard.writeText(note.path);
    toast("Copied file path.", "info");
  };

  const bookmarkCurrent = async () => {
    if (!activeTabId) return;
    await bookmarkApi.add(vaultId, activeTabId);
    void queryClient.invalidateQueries({ queryKey: ["bookmarks", vaultId] });
    void queryClient.invalidateQueries({ queryKey: ["bookmark", vaultId, activeTabId] });
    toast("Bookmarked.", "info");
  };

  const bookmarkAllTabs = async () => {
    const noteTabs = useWorkspaceStore
      .getState()
      .panes.flatMap((p) => p.tabs)
      .filter((t) => t.kind === "note");
    await Promise.all(noteTabs.map((t) => bookmarkApi.add(vaultId, t.id)));
    void queryClient.invalidateQueries({ queryKey: ["bookmarks", vaultId] });
    toast(`Bookmarked ${noteTabs.length} note${noteTabs.length === 1 ? "" : "s"}.`, "info");
  };

  const newCanvas = async () => {
    const canvas = await canvasApi.create(vaultId, "Untitled canvas");
    void queryClient.invalidateQueries({ queryKey: ["canvases", vaultId] });
    useWorkspaceStore.getState().openTab({ id: canvas.id, kind: "canvas", title: canvas.name });
  };

  const newFolder = async () => {
    for (let i = 1; i <= 25; i++) {
      const name = i === 1 ? "New folder" : `New folder ${i}`;
      try {
        await folderApi.create(vaultId, { name, parent_id: null });
        void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
        useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "files" });
        toast(`Created “${name}”.`, "info");
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) continue;
        throw e;
      }
    }
  };

  const createNoteRight = async () => {
    const created = await noteApi.create(vaultId, {
      title: `Untitled ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      folder_path: resolveNewNoteFolder(queryClient, vaultId),
    });
    void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
    void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
    if (useWorkspaceStore.getState().panes.length < 2) useWorkspaceStore.getState().splitRight();
    openNoteTab(created);
  };

  const focusPane = (dir: 1 | -1) => {
    const s = useWorkspaceStore.getState();
    s.setActivePane(dir === 1 ? Math.min(s.activePane + 1, s.panes.length - 1) : Math.max(s.activePane - 1, 0));
  };

  const setRightPanel = (pane: "backlinks" | "outgoing" | "tags" | "outline" | "local-graph" | "ai") =>
    useWorkspaceStore.setState({ rightSidebarOpen: true, rightPane: pane });

  const zoom = (delta: number) =>
    toggleSetting({
      editorFontSize: Math.min(24, Math.max(14, editorPrefs.editorFontSize + delta)),
    });

  const cycleDefaultMode = () => {
    const order = ["live", "source", "reading"] as const;
    const next = order[(order.indexOf(editorPrefs.defaultViewMode) + 1) % order.length];
    toggleSetting({ defaultViewMode: next });
  };

  // Labels: "Category: action" (or plain for core actions), listed alphabetically;
  // cmdk re-ranks by relevance once you type.
  const commands: PaletteCommand[] = [
    { id: "new-note", label: "Create new note", hotkey: "⌘N", run: onNewNote },
    { id: "new-tab", label: "New tab", run: onNewNote },
    { id: "create-note-right", label: "Create note to the right", run: guard(createNoteRight), needsNote: true },
    { id: "duplicate-note", label: "Duplicate current file", run: guard(duplicateNote), needsNote: true },
    { id: "delete-note", label: "Delete current file", run: onDeleteActiveNote, needsNote: true },
    { id: "copy-path", label: "Copy file path", run: guard(copyNotePath), needsNote: true },
    { id: "bookmark-note", label: "Bookmark…", run: guard(bookmarkCurrent), needsNote: true },
    { id: "bookmark-all", label: "Bookmark all tabs", run: guard(bookmarkAllTabs), needsTab: true },
    { id: "daily-note", label: "Daily notes: Open today's daily note", run: onOpenDailyNote },
    { id: "insert-template", label: "Insert template", run: onInsertTemplate, needsNote: true },
    { id: "version-history", label: "Version history: Show version history", run: () => setVersionsOpen(true), needsNote: true },
    { id: "new-canvas", label: "Canvas: Create new canvas", run: guard(newCanvas) },
    { id: "new-folder", label: "Files: Create new folder", run: guard(newFolder) },
    { id: "quick-switcher", label: "Quick switcher: Open quick switcher", hotkey: "⌘O", run: () => setSwitcherOpen(true) },
    { id: "graph", label: "Graph view: Open graph view", hotkey: "⌘G", run: onOpenGraph },
    { id: "local-graph", label: "Graph view: Open local graph", run: () => setRightPanel("local-graph"), needsNote: true },
    { id: "search-files", label: "Search: Search in all files", run: () => useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "search" }) },
    { id: "nav-back", label: "Navigate back", hotkey: "⌘[", run: () => useWorkspaceStore.getState().navigateBack() },
    { id: "nav-forward", label: "Navigate forward", hotkey: "⌘]", run: () => useWorkspaceStore.getState().navigateForward() },
    { id: "close-tab", label: "Close current tab", hotkey: "⌘W", run: onCloseActiveTab, needsTab: true },
    { id: "close-others", label: "Close all other tabs", run: () => useWorkspaceStore.getState().closeOtherTabs(), needsTab: true },
    { id: "close-group", label: "Close this tab group", run: () => useWorkspaceStore.getState().closePane(useWorkspaceStore.getState().activePane), needsTab: true },
    { id: "next-tab", label: "Go to next tab", run: () => useWorkspaceStore.getState().goToRelativeTab(1), needsTab: true },
    { id: "prev-tab", label: "Go to previous tab", run: () => useWorkspaceStore.getState().goToRelativeTab(-1), needsTab: true },
    { id: "last-tab", label: "Go to last tab", hotkey: "⌘9", run: () => useWorkspaceStore.getState().goToTabIndex(-1), needsTab: true },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `tab-${i + 1}`,
      label: `Go to tab #${i + 1}`,
      hotkey: `⌘${i + 1}`,
      run: () => useWorkspaceStore.getState().goToTabIndex(i),
      needsTab: true,
    })),
    { id: "focus-right-pane", label: "Focus on tab group to the right", run: () => focusPane(1), needsTab: true },
    { id: "focus-left-pane", label: "Focus on tab group to the left", run: () => focusPane(-1), needsTab: true },
    { id: "split-right", label: "Split right", hotkey: "⌘\\", run: () => useWorkspaceStore.getState().splitRight(), needsNote: true },
    { id: "toggle-pin", label: "Toggle pin on current tab", run: () => activeTabId && useWorkspaceStore.getState().togglePin(activeTabId, activePane), needsTab: true },
    { id: "mode-live", label: "Editor: Live Preview", run: () => setMode("live"), needsNote: true },
    { id: "mode-source", label: "Editor: Source mode", run: () => setMode("source"), needsNote: true },
    { id: "mode-reading", label: "Editor: Reading view", run: () => setMode("reading"), needsNote: true },
    { id: "zoom-in", label: "Zoom in", run: () => zoom(1) },
    { id: "zoom-out", label: "Zoom out", run: () => zoom(-1) },
    { id: "zoom-reset", label: "Reset zoom", run: () => toggleSetting({ editorFontSize: EDITOR_SETTING_DEFAULTS.editorFontSize }) },
    { id: "toggle-default-mode", label: "Toggle default mode for new tabs", run: cycleDefaultMode },
    { id: "toggle-line-numbers", label: "Toggle line numbers", run: () => toggleSetting({ showLineNumbers: !editorPrefs.showLineNumbers }) },
    { id: "toggle-spellcheck", label: "Toggle spellcheck", run: () => toggleSetting({ spellcheck: !editorPrefs.spellcheck }) },
    { id: "toggle-readable-width", label: "Toggle readable line length", run: () => toggleSetting({ readableLineLength: !editorPrefs.readableLineLength }) },
    { id: "show-backlinks", label: "Backlinks: Show backlinks for the current note", run: () => setRightPanel("backlinks"), needsNote: true },
    { id: "show-outgoing", label: "Outgoing links: Show outgoing links", run: () => setRightPanel("outgoing"), needsNote: true },
    { id: "show-outline", label: "Outline: Show outline of the current file", run: () => setRightPanel("outline"), needsNote: true },
    { id: "show-tags", label: "Tags view: Show tags", run: () => setRightPanel("tags") },
    { id: "show-ai", label: "AI: Open chat", run: () => setRightPanel("ai") },
    { id: "help-tour", label: "Help: Show the tour again", run: () => useWorkspaceStore.getState().setTourOpen(true) },
    {
      id: "ai-settings",
      label: "AI: Configure provider and API key",
      run: () => useWorkspaceStore.getState().openSettings("AI"),
    },
    { id: "toggle-left", label: "Toggle left sidebar", run: toggleLeft },
    { id: "toggle-right", label: "Toggle right sidebar", run: toggleRight },
    { id: "toggle-ribbon", label: "Toggle ribbon", run: () => toggleSetting({ showRibbon: !parseUserPrefs(user?.settings).showRibbon }) },
    { id: "show-file-explorer", label: "Files: Show file explorer", run: () => useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "files" }) },
    { id: "show-bookmarks", label: "Bookmarks: Show bookmarks", run: () => useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "bookmarks" }) },
    { id: "settings", label: "Open settings", hotkey: "⌘,", run: onOpenSettings },
    { id: "export-vault", label: "Export vault as a zip", run: onExportVault },
    { id: "import-vault", label: "Import notes from a zip", run: onImportVault },
    { id: "import-folder", label: "Import a vault folder…", run: onImportFolder },
    // Plugin-contributed commands, namespaced so a plugin can't shadow a core one
    ...pluginCommands.map((c) => ({
      id: `plugin:${c.pluginId}:${c.commandId}`,
      label: c.label,
      run: () => onRunPluginCommand(c.pluginId, c.commandId),
    })),
    {
      // router.push("/vault") used to bounce straight back here: the dispatcher
      // resolves to the vault you are already in. Send people to the list.
      id: "switch-vault",
      label: "Change vault…",
      run: () => useWorkspaceStore.getState().openSettings("Vault"),
    },
    { id: "reload", label: "Reload app without saving", run: () => window.location.reload() },
    {
      id: "logout",
      label: "Log out",
      run: async () => {
        await logout();
        router.replace("/");
      },
    },
  ]
    .filter((c) => (!c.needsNote || hasActiveNote) && (!c.needsTab || hasTab))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Run a command"
      className="border border-ob-border bg-[var(--ob-color-base-25)] shadow-2xl sm:max-w-[720px]"
    >
      <Command>
        <CommandInput
          placeholder="Select a command..."
          showSearchIcon={false}
          onClose={() => setOpen(false)}
        />
        <CommandList className="max-h-[min(60vh,560px)]">
          <CommandEmpty>No matching commands.</CommandEmpty>
          {commands.map((c) => (
            <CommandItem
              key={c.id}
              value={c.label}
              className="px-3 py-2"
              onSelect={() => {
                setOpen(false);
                void c.run();
              }}
            >
              <span>{c.label}</span>
              {c.hotkey && <CommandShortcut>{c.hotkey}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandList>
        <div className="flex items-center justify-center gap-4 border-t border-ob-border px-3 py-2 text-[11px] text-ob-faint">
          <span>
            <kbd className="rounded border border-ob-border px-1">↑↓</kbd> to navigate
          </span>
          <span>
            <kbd className="rounded border border-ob-border px-1">↵</kbd> to use
          </span>
          <span>
            <kbd className="rounded border border-ob-border px-1">esc</kbd> to dismiss
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
