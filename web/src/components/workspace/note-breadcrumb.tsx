"use client";

/**
 * The note's location, centred above the editor — Obsidian's inline title
 * path. Folder segments reveal that folder in the explorer; the last segment
 * is the file name and renames in place.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { vaultApi } from "@/lib/api/endpoints";
import type { Note, TreeItem } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

/** Find the folder id for a slash-path, so a crumb can point at a real folder. */
function folderIdForPath(items: TreeItem[], path: string, trail = ""): string | null {
  for (const item of items) {
    if (item.type !== "folder") continue;
    const here = trail ? `${trail}/${item.name}` : item.name;
    if (here === path) return item.id;
    const nested = folderIdForPath(item.children, path, here);
    if (nested) return nested;
  }
  return null;
}

export function NoteBreadcrumb({
  vaultId,
  note,
  onRename,
}: {
  vaultId: string;
  note: Note;
  onRename: (title: string) => void;
}) {
  const revealNote = useWorkspaceStore((s) => s.revealNote);
  const revealFolder = useWorkspaceStore((s) => s.revealFolder);
  const setLeftPane = useWorkspaceStore((s) => s.setLeftPane);
  const leftSidebarOpen = useWorkspaceStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useWorkspaceStore((s) => s.toggleLeftSidebar);

  const { data: tree } = useQuery({ queryKey: ["tree", vaultId], queryFn: () => vaultApi.tree(vaultId) });

  const [editing, setEditing] = useState<string | null>(null);

  // note.path is "Folder/Sub/Title"; the last segment is the file itself.
  const segments = note.path.split("/").filter(Boolean);
  const folders = segments.slice(0, -1);

  const openInExplorer = (target: () => void) => {
    setLeftPane("files");
    if (!leftSidebarOpen) toggleLeftSidebar();
    target();
  };

  const commit = () => {
    const next = (editing ?? "").trim();
    setEditing(null);
    if (next && next !== note.title) onRename(next);
  };

  return (
    <nav
      aria-label="Note location"
      className="flex min-w-0 items-center gap-1 truncate text-[12px] text-ob-faint"
    >
      {folders.map((name, i) => {
        const path = folders.slice(0, i + 1).join("/");
        return (
          <span key={path} className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              className="max-w-40 truncate rounded px-1 py-0.5 hover:bg-ob-hover hover:text-ob-text"
              onClick={() =>
                openInExplorer(() => {
                  const id = tree ? folderIdForPath(tree.items, path) : null;
                  if (id) revealFolder(id);
                })
              }
            >
              {name}
            </button>
            <span aria-hidden className="text-ob-faint/60">
              /
            </span>
          </span>
        );
      })}

      {editing === null ? (
        <button
          type="button"
          aria-label="Note path"
          title="Click to rename"
          className="max-w-60 truncate rounded px-1 py-0.5 text-ob-muted hover:bg-ob-hover hover:text-ob-text"
          onClick={() => setEditing(note.title)}
          onDoubleClick={() => openInExplorer(() => revealNote(note.id))}
        >
          {note.title}
        </button>
      ) : (
        <input
          autoFocus
          aria-label="Rename note"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
          className={cn(
            "w-48 rounded border border-ob-accent bg-ob-bg px-1 py-0.5 text-[12px] text-ob-text",
            "outline-none",
          )}
        />
      )}
    </nav>
  );
}
