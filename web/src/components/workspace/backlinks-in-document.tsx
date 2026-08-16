"use client";

/** Obsidian's "Backlinks in document" — the linked-mentions list rendered at
 *  the foot of the note instead of in the right sidebar. */

import { useQuery } from "@tanstack/react-query";

import { linkApi } from "@/lib/api/endpoints";

export function BacklinksInDocument({
  vaultId,
  noteId,
  onOpen,
}: {
  vaultId: string;
  noteId: string;
  onOpen: (noteId: string, title: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["backlinks", vaultId, noteId],
    queryFn: () => linkApi.backlinks(vaultId, noteId),
  });
  const backlinks = data?.backlinks ?? [];

  return (
    <section className="mt-10 border-t border-ob-border pt-4" aria-label="Backlinks">
      <h2 className="mb-2 text-[11px] font-medium tracking-wide text-ob-faint uppercase">
        {isLoading ? "Linked mentions" : `Linked mentions (${backlinks.length})`}
      </h2>
      {!isLoading && backlinks.length === 0 && (
        <p className="text-[13px] text-ob-faint">No backlinks yet.</p>
      )}
      <ul className="space-y-2">
        {backlinks.map((b) => (
          <li key={b.note_id}>
            <button
              type="button"
              onClick={() => onOpen(b.note_id, b.title)}
              className="text-[13px] text-ob-accent hover:underline"
            >
              {b.title}
            </button>
            {b.snippets.slice(0, 2).map((s, i) => (
              <p key={i} className="mt-0.5 truncate text-[12px] text-ob-faint">
                {s}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
