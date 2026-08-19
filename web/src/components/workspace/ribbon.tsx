"use client";

/** Left ribbon — Obsidian's narrow vertical icon strip. */

import {
  BookOpen,
  CalendarDays,
  CircleHelp,
  Command,
  GitFork,
  Keyboard,
  LogOut,
  PanelLeft,
  Route,
  Search,
  Settings,
  SquarePen,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DOCS_URL } from "@/lib/app-meta";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

function RibbonButton({
  label,
  onClick,
  tour,
  children,
}: {
  label: string;
  onClick?: () => void;
  /** Anchor name for the onboarding tour's spotlight. */
  tour?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-tour={tour}
          onClick={onClick}
          className="flex size-7 items-center justify-center rounded-md text-ob-muted transition-colors duration-150 hover:bg-ob-hover hover:text-ob-text"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** "?" — the way back to the tour and the shortcuts, always one click away. */
function HelpMenu() {
  const setTourOpen = useWorkspaceStore((s) => s.setTourOpen);
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  return (
    <DropdownMenu>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Help"
              data-tour="help"
              className="flex size-7 items-center justify-center rounded-md text-ob-muted transition-colors duration-150 hover:bg-ob-hover hover:text-ob-text"
            >
              <CircleHelp className="size-[18px]" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Help</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="right"
        align="end"
        className="w-52"
        // "Show the tour again": the tour has just taken focus — do not hand it
        // back to this button under the veil.
        onCloseAutoFocus={(e) => {
          if (useWorkspaceStore.getState().tourOpen) e.preventDefault();
        }}
      >
        <DropdownMenuItem asChild>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            <BookOpen className="mr-2 size-3.5" strokeWidth={2} />
            Documentation
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTourOpen(true)}>
          <Route className="mr-2 size-3.5" strokeWidth={2} />
          Show the tour again
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSettings("Hotkeys")}>
          <Keyboard className="mr-2 size-3.5" strokeWidth={2} />
          Keyboard shortcuts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Ribbon({
  onNewNote,
  onOpenGraph,
  onOpenDailyNote,
  onOpenSettings,
}: {
  onNewNote: () => void;
  onOpenGraph: () => void;
  onOpenDailyNote?: () => void;
  onOpenSettings: () => void;
}) {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const toggleLeftSidebar = useWorkspaceStore((s) => s.toggleLeftSidebar);
  const setSwitcherOpen = useWorkspaceStore((s) => s.setSwitcherOpen);
  const setPaletteOpen = useWorkspaceStore((s) => s.setPaletteOpen);

  return (
    <aside data-tour="ribbon" className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-ob-border bg-ob-sidebar pt-2 pb-3">
      <RibbonButton label="Toggle left sidebar" onClick={toggleLeftSidebar}>
        <PanelLeft className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton label="New note" onClick={onNewNote}>
        <SquarePen className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton label="Quick switcher (⌘O)" tour="switcher" onClick={() => setSwitcherOpen(true)}>
        <Search className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton label="Open graph view (⌘G)" tour="graph" onClick={onOpenGraph}>
        <GitFork className="size-[18px] rotate-90" strokeWidth={1.75} />
      </RibbonButton>
      {onOpenDailyNote && (
        <RibbonButton label="Open today's daily note" onClick={onOpenDailyNote}>
          <CalendarDays className="size-[18px]" strokeWidth={1.75} />
        </RibbonButton>
      )}
      <RibbonButton label="Command palette (⌘P)" tour="palette" onClick={() => setPaletteOpen(true)}>
        <Command className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>

      <div className="flex-1" />

      <HelpMenu />
      <RibbonButton label="Settings (⌘,)" onClick={onOpenSettings}>
        <Settings className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton
        label="Log out"
        onClick={async () => {
          await logout();
          router.replace("/");
        }}
      >
        <LogOut className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
    </aside>
  );
}
