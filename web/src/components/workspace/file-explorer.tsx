"use client";

/**
 * File explorer — Obsidian's folder tree with context menus.
 * Rows are virtualized (@tanstack/react-virtual): a 100k-note vault renders
 * only the ~40 visible rows instead of the whole tree.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, FilePlus2, FolderPlus } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { folderApi, noteApi, vaultApi } from "@/lib/api/endpoints";
import type { TreeItem } from "@/lib/api/types";
import { toastError } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 26;

interface ExplorerProps {
  vaultId: string;
  activeNoteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}

type FlatRow =
  | { kind: "folder"; id: string; name: string; depth: number; collapsed: boolean }
  | { kind: "note"; id: string; title: string; depth: number }
  | { kind: "create-input"; parentId: string | null; createKind: "note" | "folder"; depth: number };

function flattenTree(
  items: TreeItem[],
  collapsed: Set<string>,
  creating: { kind: "note" | "folder"; parentId: string | null } | null,
  depth = 0,
  parentId: string | null = null,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const item of items) {
    if (item.type === "folder") {
      const isCollapsed = collapsed.has(item.id);
      rows.push({ kind: "folder", id: item.id, name: item.name, depth, collapsed: isCollapsed });
      if (!isCollapsed) {
        rows.push(...flattenTree(item.children, collapsed, creating, depth + 1, item.id));
      }
    }
  }
  if (creating && creating.parentId === parentId) {
    rows.push({
      kind: "create-input",
      parentId,
      createKind: creating.kind,
      depth: depth + (parentId ? 1 : 0),
    });
  }
  for (const item of items) {
    if (item.type === "note") {
      rows.push({ kind: "note", id: item.id, title: item.title, depth });
    }
  }
  return rows;
}

export function FileExplorer({ vaultId, activeNoteId, onOpenNote }: ExplorerProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; kind: "note" | "folder"; value: string } | null>(
    null,
  );
  const [creating, setCreating] = useState<{
    kind: "note" | "folder";
    parentId: string | null;
    value: string;
  } | null>(null);

  const rows = useMemo(
    () =>
      tree
        ? flattenTree(
            tree.items,
            collapsed,
            creating ? { kind: creating.kind, parentId: creating.parentId } : null,
          )
        : [],
    [tree, collapsed, creating],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

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

  const expandFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 pb-4">
        {!tree && <p className="px-2 py-1 text-[13px] text-ob-faint">Loading…</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            return (
              <div
                key={vRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${String(vRow.start)}px)`,
                }}
              >
                {row.kind === "folder" && (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleFolder(row.id)}
                        onKeyDown={(e) => e.key === "Enter" && toggleFolder(row.id)}
                        className="flex h-[26px] cursor-default items-center gap-1 rounded px-2 text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
                        style={{ paddingLeft: 8 + row.depth * 14 }}
                      >
                        {row.collapsed ? (
                          <ChevronRight className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />
                        )}
                        {renaming?.id === row.id ? (
                          <InlineInput
                            value={renaming.value}
                            onChange={(v) => setRenaming({ ...renaming, value: v })}
                            onSubmit={submitRename}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="truncate font-medium">{row.name}</span>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem
                        onClick={() => {
                          expandFolder(row.id);
                          setCreating({ kind: "note", parentId: row.id, value: "" });
                        }}
                      >
                        New note
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          expandFolder(row.id);
                          setCreating({ kind: "folder", parentId: row.id, value: "" });
                        }}
                      >
                        New folder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => setRenaming({ id: row.id, kind: "folder", value: row.name })}
                      >
                        Rename…
                      </ContextMenuItem>
                      <ContextMenuItem variant="destructive" onClick={() => deleteFolder.mutate(row.id)}>
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}

                {row.kind === "note" && (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenNote(row.id, row.title)}
                        onKeyDown={(e) => e.key === "Enter" && onOpenNote(row.id, row.title)}
                        className={cn(
                          "flex h-[26px] cursor-default items-center rounded px-2 text-[13px]",
                          activeNoteId === row.id
                            ? "bg-ob-active text-ob-text"
                            : "text-ob-muted hover:bg-ob-hover hover:text-ob-text",
                        )}
                        style={{ paddingLeft: 8 + row.depth * 14 + 18 }}
                      >
                        {renaming?.id === row.id ? (
                          <InlineInput
                            value={renaming.value}
                            onChange={(v) => setRenaming({ ...renaming, value: v })}
                            onSubmit={submitRename}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="truncate">{row.title}</span>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem
                        onClick={() => setRenaming({ id: row.id, kind: "note", value: row.title })}
                      >
                        Rename…
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onClick={() => deleteNote.mutate(row.id)}>
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}

                {row.kind === "create-input" && creating && (
                  <div
                    className="flex h-[26px] items-center px-2"
                    style={{ paddingLeft: 8 + row.depth * 14 }}
                  >
                    <InlineInput
                      value={creating.value}
                      onChange={(v) => setCreating({ ...creating, value: v })}
                      onSubmit={submitCreate}
                      onCancel={() => setCreating(null)}
                      placeholder={creating.kind === "note" ? "Note name" : "Folder name"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
