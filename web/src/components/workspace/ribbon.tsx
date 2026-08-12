"use client";

/** Left ribbon — Obsidian's narrow vertical icon strip. */

import {
  CalendarDays,
  Command,
  GitFork,
  LogOut,
  PanelLeft,
  Search,
  SquarePen,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

function RibbonButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
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

export function Ribbon({
  onNewNote,
  onOpenGraph,
  onOpenDailyNote,
}: {
  onNewNote: () => void;
  onOpenGraph: () => void;
  onOpenDailyNote?: () => void;
}) {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const toggleLeftSidebar = useWorkspaceStore((s) => s.toggleLeftSidebar);
  const setSwitcherOpen = useWorkspaceStore((s) => s.setSwitcherOpen);
  const setPaletteOpen = useWorkspaceStore((s) => s.setPaletteOpen);

  return (
    <aside className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-ob-border bg-ob-sidebar pt-2 pb-3">
      <RibbonButton label="Toggle left sidebar" onClick={toggleLeftSidebar}>
        <PanelLeft className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton label="New note" onClick={onNewNote}>
        <SquarePen className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton label="Quick switcher (⌘O)" onClick={() => setSwitcherOpen(true)}>
        <Search className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>
      <RibbonButton label="Open graph view (⌘G)" onClick={onOpenGraph}>
        <GitFork className="size-[18px] rotate-90" strokeWidth={1.75} />
      </RibbonButton>
      {onOpenDailyNote && (
        <RibbonButton label="Open today's daily note" onClick={onOpenDailyNote}>
          <CalendarDays className="size-[18px]" strokeWidth={1.75} />
        </RibbonButton>
      )}
      <RibbonButton label="Command palette (⌘P)" onClick={() => setPaletteOpen(true)}>
        <Command className="size-[18px]" strokeWidth={1.75} />
      </RibbonButton>

      <div className="flex-1" />

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
