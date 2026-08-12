"use client";

/** Bookmarks pane — starred notes (left sidebar). */

import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";

import { bookmarkApi } from "@/lib/api/endpoints";

export function BookmarksPane({
  vaultId,
  onOpenNote,
}: {
  vaultId: string;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["bookmarks", vaultId],
    queryFn: () => bookmarkApi.list(vaultId),
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto px-2 py-2">
      {data && data.length === 0 && (
        <p className="px-2 py-1 text-[12px] text-ob-faint">
          No bookmarks yet. Star a note with the bookmark icon in its header.
        </p>
      )}
      {data?.map((b) => (
        <button
          key={b.note_id}
          type="button"
          onClick={() => onOpenNote(b.note_id, b.title)}
          className="flex h-[26px] items-center gap-1.5 rounded px-2 text-left text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
        >
          <Bookmark className="size-3.5 shrink-0 text-ob-accent" strokeWidth={1.75} />
          <span className="truncate">{b.title}</span>
        </button>
      ))}
    </div>
  );
}
