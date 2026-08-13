"use client";

/** Command palette (⌘P) — Obsidian's every-action-searchable dialog. */

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
import { authApi } from "@/lib/api/endpoints";
import { parseEditorSettings } from "@/lib/hooks/use-editor-settings";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toastError } from "@/lib/stores/toast-store";
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
  onNewNote: () => void;
  onOpenGraph: () => void;
  onDeleteActiveNote: () => void;
  onCloseActiveTab: () => void;
  onOpenDailyNote: () => void;
  onInsertTemplate: () => void;
  onExportVault: () => void;
  onImportVault: () => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  onNewNote,
  onOpenGraph,
  onDeleteActiveNote,
  onCloseActiveTab,
  onOpenDailyNote,
  onInsertTemplate,
  onExportVault,
  onImportVault,
  onOpenSettings,
}: CommandPaletteProps) {
  const router = useRouter();
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

  const hasActiveNote = tabs.some((t) => t.id === activeTabId && t.kind === "note");
  const hasTab = activeTabId !== null;
  const editorPrefs = parseEditorSettings(user?.settings);

  // Optimistic user-setting toggle (editor prefs are read live from the store).
  const toggleSetting = (patch: Record<string, unknown>) => {
    const current = useAuthStore.getState().user;
    if (current) setUser({ ...current, settings: { ...current.settings, ...patch } });
    authApi.updateMe({ settings: patch }).catch((e) => toastError(e, "Could not save setting."));
  };

  // Obsidian labels commands "Category: action" (or plain for core actions) and
  // lists them alphabetically; cmdk re-ranks by relevance once you type.
  const commands: PaletteCommand[] = [
    { id: "new-note", label: "Create new note", hotkey: "⌘N", run: onNewNote },
    { id: "delete-note", label: "Delete current file", run: onDeleteActiveNote, needsNote: true },
    { id: "daily-note", label: "Daily notes: Open today's daily note", run: onOpenDailyNote },
    { id: "insert-template", label: "Insert template", run: onInsertTemplate, needsNote: true },
    { id: "version-history", label: "Version history: Show version history", run: () => setVersionsOpen(true), needsNote: true },
    { id: "quick-switcher", label: "Quick switcher: Open quick switcher", hotkey: "⌘O", run: () => setSwitcherOpen(true) },
    { id: "graph", label: "Graph view: Open graph view", hotkey: "⌘G", run: onOpenGraph },
    { id: "search-files", label: "Search: Search in all files", run: () => useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "search" }) },
    { id: "nav-back", label: "Navigate back", hotkey: "⌘[", run: () => useWorkspaceStore.getState().navigateBack() },
    { id: "nav-forward", label: "Navigate forward", hotkey: "⌘]", run: () => useWorkspaceStore.getState().navigateForward() },
    { id: "close-tab", label: "Close current tab", hotkey: "⌘W", run: onCloseActiveTab, needsTab: true },
    { id: "close-others", label: "Close all other tabs", run: () => useWorkspaceStore.getState().closeOtherTabs(), needsTab: true },
    { id: "next-tab", label: "Go to next tab", run: () => useWorkspaceStore.getState().goToRelativeTab(1), needsTab: true },
    { id: "prev-tab", label: "Go to previous tab", run: () => useWorkspaceStore.getState().goToRelativeTab(-1), needsTab: true },
    { id: "toggle-pin", label: "Toggle pin on current tab", run: () => activeTabId && useWorkspaceStore.getState().togglePin(activeTabId, activePane), needsTab: true },
    { id: "split-right", label: "Split right", hotkey: "⌘\\", run: () => useWorkspaceStore.getState().splitRight(), needsNote: true },
    { id: "mode-live", label: "Editor: Live Preview", run: () => setMode("live"), needsNote: true },
    { id: "mode-source", label: "Editor: Source mode", run: () => setMode("source"), needsNote: true },
    { id: "mode-reading", label: "Editor: Reading view", run: () => setMode("reading"), needsNote: true },
    { id: "toggle-line-numbers", label: "Toggle line numbers", run: () => toggleSetting({ showLineNumbers: !editorPrefs.showLineNumbers }) },
    { id: "toggle-spellcheck", label: "Toggle spellcheck", run: () => toggleSetting({ spellcheck: !editorPrefs.spellcheck }) },
    { id: "toggle-readable-width", label: "Toggle readable line length", run: () => toggleSetting({ readableLineLength: !editorPrefs.readableLineLength }) },
    { id: "toggle-left", label: "Toggle left sidebar", run: toggleLeft },
    { id: "toggle-right", label: "Toggle right sidebar", run: toggleRight },
    { id: "show-file-explorer", label: "Files: Show file explorer", run: () => useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "files" }) },
    { id: "show-bookmarks", label: "Bookmarks: Show bookmarks", run: () => useWorkspaceStore.setState({ leftSidebarOpen: true, leftPane: "bookmarks" }) },
    { id: "settings", label: "Open settings", hotkey: "⌘,", run: onOpenSettings },
    { id: "export-vault", label: "Export vault as a zip", run: onExportVault },
    { id: "import-vault", label: "Import notes from a zip", run: onImportVault },
    { id: "switch-vault", label: "Change vault…", run: () => router.push("/vault") },
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
