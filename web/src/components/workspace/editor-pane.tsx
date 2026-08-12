"use client";

/**
 * Editor pane — inline title + markdown source editor with debounced autosave.
 * The plain textarea is an interim body: feature/web-editor replaces it with
 * the CodeMirror 6 live-preview editor while keeping this pane's chrome.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { noteApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function EditorPane({ vaultId, noteId }: { vaultId: string; noteId: string }) {
  const { data: note } = useQuery({
    queryKey: ["note", vaultId, noteId],
    queryFn: () => noteApi.get(vaultId, noteId),
  });

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ob-faint">Loading…</div>
    );
  }

  // key remounts the body when switching notes — local draft state resets
  // naturally without effect-based syncing.
  return <EditorBody key={noteId} vaultId={vaultId} note={note} />;
}

function EditorBody({ vaultId, note }: { vaultId: string; note: Note }) {
  const queryClient = useQueryClient();
  const renameTab = useWorkspaceStore((s) => s.renameTab);

  const [draft, setDraft] = useState(note.content);
  const [title, setTitle] = useState(note.title);
  const baseUpdatedAt = useRef(note.updated_at);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (content: string) =>
      noteApi.saveContent(vaultId, note.id, content, baseUpdatedAt.current),
    onSuccess: (saved: Note) => {
      baseUpdatedAt.current = saved.updated_at;
      queryClient.setQueryData(["note", vaultId, note.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["outgoing", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
    },
    onError: async () => {
      // Conflict or transient failure — refetch server state; keep the draft.
      await queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
    },
  });

  const scheduleSave = useCallback(
    (content: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save.mutate(content), 700);
    },
    [save],
  );

  const rename = useMutation({
    mutationFn: (newTitle: string) => noteApi.rename(vaultId, note.id, { title: newTitle }),
    onSuccess: (meta) => {
      renameTab(note.id, meta.title);
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-ob-bg">
      <div className="mx-auto min-h-full max-w-[44rem] px-8 pt-8 pb-32">
        <input
          value={title}
          aria-label="Note title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim();
            if (t && t !== note.title) rename.mutate(t);
            else setTitle(note.title);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="mb-3 w-full bg-transparent text-[1.75em] leading-tight font-bold text-ob-text outline-none focus-visible:outline-none"
        />
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            scheduleSave(e.target.value);
          }}
          spellCheck={false}
          aria-label="Note content"
          className="min-h-[70vh] w-full resize-none bg-transparent text-[16px] leading-[1.6] text-ob-text outline-none focus-visible:outline-none placeholder:text-ob-faint"
          placeholder="Start writing…"
        />
      </div>
    </div>
  );
}
