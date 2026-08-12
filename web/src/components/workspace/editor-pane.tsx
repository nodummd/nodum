"use client";

/**
 * Editor pane — inline title, mode toggle (live / source / reading),
 * CodeMirror 6 body with debounced autosave and wikilink navigation.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Code2, Pencil } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { ReadingView } from "@/components/editor/reading-view";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { noteApi, searchApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

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
  const openTab = useWorkspaceStore((s) => s.openTab);
  const mode = useWorkspaceStore((s) => s.editorMode);
  const setMode = useWorkspaceStore((s) => s.setEditorMode);

  const [title, setTitle] = useState(note.title);
  // draft lives in state (render-safe) and a ref (event-safe for save callbacks)
  const [draft, setDraft] = useState(note.content);
  const draftRef = useRef(note.content);
  const baseUpdatedAt = useRef(note.updated_at);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (content: string) =>
      noteApi.saveContent(vaultId, note.id, content, baseUpdatedAt.current),
    onSuccess: (saved: Note) => {
      baseUpdatedAt.current = saved.updated_at;
      queryClient.setQueryData(["note", vaultId, note.id], { ...saved, content: draftRef.current });
      void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["outgoing", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
    },
    onError: async () => {
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
            <ReadingView content={draft} onNavigate={(t) => void navigate(t)} />
          ) : (
            <MarkdownEditor
              vaultId={vaultId}
              initialContent={draft}
              mode={mode}
              onChange={onChange}
              onNavigate={(t) => void navigate(t)}
            />
          )}
        </div>
      </div>
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
