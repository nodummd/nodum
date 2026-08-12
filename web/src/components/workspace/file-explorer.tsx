"use client";

/** File explorer — Obsidian's folder tree with context menus. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FilePlus2, FolderPlus } from "lucide-react";
import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { folderApi, noteApi, vaultApi } from "@/lib/api/endpoints";
import { toastError } from "@/lib/stores/toast-store";
import type { TreeItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface ExplorerProps {
  vaultId: string;
  activeNoteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}

export function FileExplorer({ vaultId, activeNoteId, onOpenNote }: ExplorerProps) {
  const queryClient = useQueryClient();
  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; kind: "note" | "folder"; value: string } | null>(
    null,
  );
  const [creating, setCreating] = useState<{ kind: "note" | "folder"; parentId: string | null; value: string } | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
    void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
  };

  const createNote = useMutation({
    mutationFn: (v: { title: string; folderId: string | null }) =>
      noteApi.create(vaultId, { title: v.title, folder_id: v.folderId }),
    onSuccess: (note) => {
      invalidate();
      onOpenNote(note.id, note.title);
    },
    onError: (err) => toastError(err, "Could not create note."),
  });
  const createFolder = useMutation({
    mutationFn: (v: { name: string; parentId: string | null }) =>
      folderApi.create(vaultId, { name: v.name, parent_id: v.parentId }),
    onSuccess: invalidate,
    onError: (err) => toastError(err, "Could not create folder."),
  });
  const renameNote = useMutation({
    mutationFn: (v: { id: string; title: string }) => noteApi.rename(vaultId, v.id, { title: v.title }),
    onSuccess: invalidate,
    onError: (err) => toastError(err, "Could not rename note."),
  });
  const renameFolder = useMutation({
    mutationFn: (v: { id: string; name: string }) => folderApi.rename(vaultId, v.id, v.name),
    onSuccess: invalidate,
    onError: (err) => toastError(err, "Could not rename folder."),
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => noteApi.remove(vaultId, id),
    onSuccess: invalidate,
    onError: (err) => toastError(err, "Could not delete note."),
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => folderApi.remove(vaultId, id),
    onSuccess: invalidate,
    onError: (err) => toastError(err, "Could not delete folder."),
  });

  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitCreate = () => {
    if (!creating) return;
    const value = creating.value.trim();
    if (value) {
      if (creating.kind === "note") createNote.mutate({ title: value, folderId: creating.parentId });
      else createFolder.mutate({ name: value, parentId: creating.parentId });
    }
    setCreating(null);
  };

  const submitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (value) {
      if (renaming.kind === "note") renameNote.mutate({ id: renaming.id, title: value });
      else renameFolder.mutate({ id: renaming.id, name: value });
    }
    setRenaming(null);
  };

  const renderItems = (items: TreeItem[], depth: number, parentFolderId: string | null) => (
    <>
      {items
        .filter((i) => i.type === "folder")
        .map((folder) => {
          if (folder.type !== "folder") return null;
          const isCollapsed = collapsed.has(folder.id);
          return (
            <div key={folder.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFolder(folder.id)}
                    onKeyDown={(e) => e.key === "Enter" && toggleFolder(folder.id)}
                    className="group flex h-[26px] cursor-default items-center gap-1 rounded px-2 text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
                    style={{ paddingLeft: 8 + depth * 14 }}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />
                    ) : (
                      <ChevronDown className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />
                    )}
                    {renaming?.id === folder.id ? (
                      <InlineInput
                        value={renaming.value}
                        onChange={(v) => setRenaming({ ...renaming, value: v })}
                        onSubmit={submitRename}
                        onCancel={() => setRenaming(null)}
                      />
                    ) : (
                      <span className="truncate font-medium">{folder.name}</span>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onClick={() => setCreating({ kind: "note", parentId: folder.id, value: "" })}
                  >
                    New note
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => setCreating({ kind: "folder", parentId: folder.id, value: "" })}
                  >
                    New folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => setRenaming({ id: folder.id, kind: "folder", value: folder.name })}
                  >
                    Rename…
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={() => deleteFolder.mutate(folder.id)}>
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {!isCollapsed && renderItems(folder.children, depth + 1, folder.id)}
            </div>
          );
        })}
      {creating && creating.parentId === parentFolderId && (
        <div className="flex h-[26px] items-center px-2" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
          <InlineInput
            value={creating.value}
            onChange={(v) => setCreating({ ...creating, value: v })}
            onSubmit={submitCreate}
            onCancel={() => setCreating(null)}
            placeholder={creating.kind === "note" ? "Note name" : "Folder name"}
          />
        </div>
      )}
      {items
        .filter((i) => i.type === "note")
        .map((note) => {
          if (note.type !== "note") return null;
          return (
            <ContextMenu key={note.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenNote(note.id, note.title)}
                  onKeyDown={(e) => e.key === "Enter" && onOpenNote(note.id, note.title)}
                  className={cn(
                    "flex h-[26px] cursor-default items-center rounded px-2 text-[13px]",
                    activeNoteId === note.id
                      ? "bg-ob-active text-ob-text"
                      : "text-ob-muted hover:bg-ob-hover hover:text-ob-text",
                  )}
                  style={{ paddingLeft: 8 + depth * 14 + 18 }}
                >
                  {renaming?.id === note.id ? (
                    <InlineInput
                      value={renaming.value}
                      onChange={(v) => setRenaming({ ...renaming, value: v })}
                      onSubmit={submitRename}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <span className="truncate">{note.title}</span>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onClick={() => setRenaming({ id: note.id, kind: "note", value: note.title })}>
                  Rename…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => deleteNote.mutate(note.id)}>
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 px-2 py-1.5">
        <button
          type="button"
          aria-label="New note"
          onClick={() => setCreating({ kind: "note", parentId: null, value: "" })}
          className="flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
        >
          <FilePlus2 className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="New folder"
          onClick={() => setCreating({ kind: "folder", parentId: null, value: "" })}
          className="flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
        >
          <FolderPlus className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {tree ? (
          renderItems(tree.items, 0, null)
        ) : (
          <p className="px-2 py-1 text-[13px] text-ob-faint">Loading…</p>
        )}
      </div>
    </div>
  );
}

function InlineInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSubmit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit();
        if (e.key === "Escape") onCancel();
      }}
      className="w-full rounded border border-ob-accent bg-ob-bg px-1 py-0.5 text-[13px] text-ob-text outline-none"
    />
  );
}
