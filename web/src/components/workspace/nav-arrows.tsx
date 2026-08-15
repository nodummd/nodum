"use client";

/** Per-pane history arrows (⌘[ / ⌘]) — Obsidian's back/forward, sitting to the
 *  left of the note's breadcrumb. Following a link navigates in place, so these
 *  are how you get back to what you were reading. Reachability uses the same
 *  helper the store navigates with, so a disabled arrow always means
 *  "nowhere to go". */

import { ArrowLeft, ArrowRight } from "lucide-react";

import { historyStep, useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

export function NavArrows({ paneIndex }: { paneIndex: number }) {
  const pane = useWorkspaceStore((s) => s.panes[paneIndex]);
  const navigateBack = useWorkspaceStore((s) => s.navigateBack);
  const navigateForward = useWorkspaceStore((s) => s.navigateForward);
  const canBack = pane ? historyStep(pane, -1) !== null : false;
  const canForward = pane ? historyStep(pane, 1) !== null : false;

  const cls = (enabled: boolean) =>
    cn(
      "flex size-6 shrink-0 items-center justify-center rounded transition-colors",
      enabled ? "text-ob-muted hover:bg-ob-hover hover:text-ob-text" : "text-ob-faint/40",
    );

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Navigate back (⌘[)"
        title="Back (⌘[)"
        disabled={!canBack}
        onClick={() => navigateBack(paneIndex)}
        className={cls(canBack)}
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Navigate forward (⌘])"
        title="Forward (⌘])"
        disabled={!canForward}
        onClick={() => navigateForward(paneIndex)}
        className={cls(canForward)}
      >
        <ArrowRight className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
