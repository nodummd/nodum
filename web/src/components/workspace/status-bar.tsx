"use client";

/** Status bar — Obsidian's bottom-right pill: backlinks · words · characters. */

import { useQuery } from "@tanstack/react-query";

import { linkApi, noteApi } from "@/lib/api/endpoints";

export function StatusBar({ vaultId, noteId }: { vaultId: string; noteId: string | null }) {
  const { data: note } = useQuery({
    queryKey: ["note", vaultId, noteId],
    queryFn: () => noteApi.get(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });
  const { data: backlinks } = useQuery({
    queryKey: ["backlinks", vaultId, noteId],
    queryFn: () => linkApi.backlinks(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });

  if (!noteId || !note) return null;

  const words = note.content.trim() ? note.content.trim().split(/\s+/).length : 0;
  const chars = note.content.length;
  const backlinkCount = backlinks?.backlinks.length ?? 0;

  return (
    <div className="pointer-events-none absolute right-0 bottom-0 z-20 flex items-center gap-3 rounded-tl-lg border-t border-l border-ob-border bg-ob-sidebar px-3 py-1 text-[12px] text-ob-faint">
      <span>
        {backlinkCount} {backlinkCount === 1 ? "backlink" : "backlinks"}
      </span>
      <span>{words} words</span>
      <span>{chars} characters</span>
    </div>
  );
}
