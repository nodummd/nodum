"use client";

/**
 * Editor pane — inline title, mode toggle (live / source / reading),
 * CodeMirror 6 body with debounced autosave and wikilink navigation.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookOpen, Code2, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { ShareButton } from "./share-button";
import { VersionHistoryDialog } from "./version-history";
import { ReadingView } from "@/components/editor/reading-view";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import { bookmarkApi, noteApi, searchApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

export function EditorPane({ vaultId, noteId }: { vaultId: string; noteId: string }) {
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const { data: note, error } = useQuery({
    queryKey: ["note", vaultId, noteId],
    queryFn: () => noteApi.get(vaultId, noteId),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    gcTime: 60_000, // full note bodies are heavy — drop quickly once unused
  });

  // Persisted workspace tabs can outlive their notes — prune on 404.
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404) closeTab(noteId);
  }, [error, closeTab, noteId]);

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
  const openTab = useWorkspaceStore((s) => s.openTab);
  const mode = useWorkspaceStore((s) => s.editorMode);
  const setMode = useWorkspaceStore((s) => s.setEditorMode);

  const versionsOpen = useWorkspaceStore((s) => s.versionsOpen);
  const setVersionsOpen = useWorkspaceStore((s) => s.setVersionsOpen);

  const [title, setTitle] = useState(note.title);
  // draft lives in state (render-safe) and a ref (event-safe for save callbacks)
  const [draft, setDraft] = useState(note.content);
  const draftRef = useRef(note.content);
  // bumped when content is replaced from outside the editor (version restore)
  // so the manually-mounted CodeMirror instance remounts with the new doc
  const [editorEpoch, setEditorEpoch] = useState(0);
  const baseUpdatedAt = useRef(note.updated_at);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictRetries = useRef(0);

  const save = useMutation({
    mutationFn: (content: string) =>
      noteApi.saveContent(vaultId, note.id, content, baseUpdatedAt.current),
    onSuccess: (saved: Note) => {
      conflictRetries.current = 0;
      baseUpdatedAt.current = saved.updated_at;
      queryClient.setQueryData(["note", vaultId, note.id], { ...saved, content: draftRef.current });
      void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["outgoing", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
    },
    onError: async (err) => {
      // 409 = another tab/device saved first. Recovery: adopt the server's
      // timestamp and resubmit the local draft once (last-writer-wins, like
      // Obsidian). Without this the editor would 409 forever silently.
      if (err instanceof ApiError && err.status === 409 && conflictRetries.current < 2) {
        conflictRetries.current += 1;
        const details = err.details as { server_updated_at?: string } | undefined;
        if (details?.server_updated_at) {
          baseUpdatedAt.current = details.server_updated_at;
          save.mutate(draftRef.current);
          return;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
    },
  });

  const onChange = useCallback(
    (content: string) => {
      draftRef.current = content;
      setDraft(content);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save.mutate(content), 700);
    },
    [save],
  );

  // Flush a pending debounced save when the pane unmounts (tab close/switch) —
  // otherwise up to 700ms of typing would be lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void noteApi.saveContent(vaultId, note.id, draftRef.current, baseUpdatedAt.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rename = useMutation({
    mutationFn: (newTitle: string) => noteApi.rename(vaultId, note.id, { title: newTitle }),
    onSuccess: (meta) => {
      renameTab(note.id, meta.title);
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
    },
  });

  /** Follow a [[wikilink]]: open by path/title, or create the note (Obsidian behavior). */
  const navigate = useCallback(
    async (target: string) => {
      try {
        const found = await noteApi.getByPath(vaultId, target);
        openTab({ id: found.id, kind: "note", title: found.title });
        return;
      } catch {
        /* not an exact path — resolve by title below */
      }
      const candidates = await searchApi.quickSwitch(vaultId, target, 5);
      const exact = candidates.find((c) => c.title.toLowerCase() === target.toLowerCase());
      if (exact) {
        openTab({ id: exact.id, kind: "note", title: exact.title });
        return;
      }
      const created = await noteApi.create(vaultId, { title: target });
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      openTab({ id: created.id, kind: "note", title: created.title });
    },
    [vaultId, openTab, queryClient],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-0.5 px-3 pt-1.5">
        <BookmarkButton vaultId={vaultId} noteId={note.id} />
        <ShareButton vaultId={vaultId} noteId={note.id} />
        <ModeButton
          label="Live preview"
          active={mode === "live"}
          onClick={() => setMode("live")}
          icon={<Pencil className="size-3.5" strokeWidth={1.75} />}
        />
        <ModeButton
          label="Source mode"
          active={mode === "source"}
          onClick={() => setMode("source")}
          icon={<Code2 className="size-3.5" strokeWidth={1.75} />}
        />
        <ModeButton
          label="Reading view"
          active={mode === "reading"}
          onClick={() => setMode("reading")}
          icon={<BookOpen className="size-3.5" strokeWidth={1.75} />}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto min-h-full max-w-[44rem] px-8 pt-4 pb-24">
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
            className="mb-4 w-full bg-transparent text-[1.802em] leading-tight font-bold text-ob-text outline-none focus-visible:outline-none"
          />
          {mode === "reading" ? (
            <ReadingView content={draft} vaultId={vaultId} onNavigate={(t) => void navigate(t)} />
          ) : (
            <MarkdownEditor
              key={editorEpoch}
              vaultId={vaultId}
              initialContent={draft}
              mode={mode}
              onChange={onChange}
              onNavigate={(t) => void navigate(t)}
            />
          )}
        </div>
      </div>
      <VersionHistoryDialog
        vaultId={vaultId}
        noteId={note.id}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        onRestored={(restored) => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          draftRef.current = restored.content;
          setDraft(restored.content);
          baseUpdatedAt.current = restored.updated_at;
          setEditorEpoch((n) => n + 1);
          queryClient.setQueryData(["note", vaultId, note.id], restored);
          void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
          void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
          void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
        }}
      />
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex size-6 items-center justify-center rounded transition-colors duration-150",
            active ? "bg-ob-active text-ob-text" : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}


function BookmarkButton({ vaultId, noteId }: { vaultId: string; noteId: string }) {
  const queryClient = useQueryClient();
  const { data: bookmarks } = useQuery({
    queryKey: ["bookmarks", vaultId],
    queryFn: () => bookmarkApi.list(vaultId),
  });
  const isBookmarked = bookmarks?.some((b) => b.note_id === noteId) ?? false;

  const toggle = useMutation({
    mutationFn: () =>
      isBookmarked ? bookmarkApi.remove(vaultId, noteId) : bookmarkApi.add(vaultId, noteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["bookmarks", vaultId] }),
  });

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this note"}
          aria-pressed={isBookmarked}
          onClick={() => toggle.mutate()}
          className={cn(
            "flex size-6 items-center justify-center rounded transition-colors duration-150",
            isBookmarked ? "text-ob-accent" : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
          )}
        >
          <Bookmark className="size-3.5" strokeWidth={1.75} fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{isBookmarked ? "Remove bookmark" : "Bookmark"}</TooltipContent>
    </Tooltip>
  );
}
