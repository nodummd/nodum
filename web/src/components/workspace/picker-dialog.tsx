"use client";

/** A filterable single-choice list in a dialog — "Move file to…", "Merge with…".
 *  Shared by the file explorer's context menu and the note's ⋯ menu. */

import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PickerDialog({
  title,
  items,
  emptyLabel,
  onPick,
  onClose,
}: {
  title: string;
  items: { id: string | null; label: string }[];
  emptyLabel: string;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">{title}</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type to filter…"
          className="h-8 w-full rounded border border-ob-border bg-ob-bg px-2 text-[13px] text-ob-text outline-none placeholder:text-ob-faint focus:border-ob-accent"
        />
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-ob-faint">{emptyLabel}</p>
          )}
          {filtered.map((i) => (
            <button
              key={i.id ?? "__root__"}
              type="button"
              onClick={() => onPick(i.id)}
              className="block w-full truncate rounded px-2 py-1.5 text-left text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
            >
              {i.label}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
