"use client";

/** Command palette (⌘P) — Obsidian's every-action-searchable dialog. */

import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  Code2,
  Download,
  FilePlus2,
  FileStack,
  GitFork,
  History,
  LogOut,
  PanelLeft,
  PanelRight,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export interface PaletteCommand {
  id: string;
  label: string;
  hotkey?: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
  /** Only shown when a note tab is active. */
  needsNote?: boolean;
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
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const logout = useAuthStore((s) => s.logout);

  const hasActiveNote = tabs.some((t) => t.id === activeTabId && t.kind === "note");

  const commands: PaletteCommand[] = [
    { id: "new-note", label: "Create new note", hotkey: "⌘N", icon: <SquarePen className="size-4" />, run: onNewNote },
    { id: "quick-switcher", label: "Open quick switcher", hotkey: "⌘O", icon: <Search className="size-4" />, run: () => setSwitcherOpen(true) },
    { id: "graph", label: "Open graph view", hotkey: "⌘G", icon: <GitFork className="size-4 rotate-90" />, run: onOpenGraph },
    { id: "daily-note", label: "Open today's daily note", icon: <CalendarDays className="size-4" />, run: onOpenDailyNote },
    { id: "insert-template", label: "Insert template…", icon: <FileStack className="size-4" />, run: onInsertTemplate, needsNote: true },
    { id: "version-history", label: "Version history", icon: <History className="size-4" />, run: () => setVersionsOpen(true), needsNote: true },
    { id: "export-vault", label: "Export vault as zip", icon: <Download className="size-4" />, run: onExportVault },
    { id: "import-vault", label: "Import notes from zip…", icon: <Upload className="size-4" />, run: onImportVault },
    { id: "settings", label: "Open settings", hotkey: "⌘,", icon: <Settings className="size-4" />, run: onOpenSettings },
    { id: "mode-live", label: "Editor: Live Preview", icon: <Pencil className="size-4" />, run: () => setMode("live"), needsNote: true },
    { id: "mode-source", label: "Editor: Source mode", icon: <Code2 className="size-4" />, run: () => setMode("source"), needsNote: true },
    { id: "mode-reading", label: "Editor: Reading view", icon: <BookOpen className="size-4" />, run: () => setMode("reading"), needsNote: true },
    { id: "toggle-left", label: "Toggle left sidebar", icon: <PanelLeft className="size-4" />, run: toggleLeft },
    { id: "toggle-right", label: "Toggle right sidebar", icon: <PanelRight className="size-4" />, run: toggleRight },
    { id: "close-tab", label: "Close current tab", hotkey: "⌘W", icon: <X className="size-4" />, run: onCloseActiveTab },
    { id: "new-file-explorer", label: "Reveal file explorer", icon: <FilePlus2 className="size-4" />, run: () => useWorkspaceStore.setState({ leftSidebarOpen: true }) },
    { id: "switch-vault", label: "Switch vault…", icon: <ArrowLeftRight className="size-4" />, run: () => router.push("/vault") },
    { id: "delete-note", label: "Delete current note", icon: <Trash2 className="size-4" />, run: onDeleteActiveNote, needsNote: true },
    {
      id: "logout",
      label: "Log out",
      icon: <LogOut className="size-4" />,
      run: async () => {
        await logout();
        router.replace("/");
      },
    },
  ].filter((c) => !c.needsNote || hasActiveNote);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Run a command"
      className="border border-ob-border bg-[var(--ob-color-base-25)] shadow-2xl sm:max-w-[540px]"
    >
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No matching commands.</CommandEmpty>
          <CommandGroup heading="Commands">
            {commands.map((c) => (
              <CommandItem
                key={c.id}
                value={c.label}
                onSelect={() => {
                  setOpen(false);
                  void c.run();
                }}
              >
                <span className="text-ob-faint">{c.icon}</span>
                <span>{c.label}</span>
                {c.hotkey && <CommandShortcut>{c.hotkey}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
