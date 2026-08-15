"use client";

/**
 * File explorer — Obsidian's folder tree with context menus.
 * Rows are virtualized (@tanstack/react-virtual): a 100k-note vault renders
 * only the ~40 visible rows instead of the whole tree.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus2,
  LocateFixed,
  FolderPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirmDelete } from "./confirm-dialog";
import { bookmarkApi, folderApi, noteApi, searchApi, vaultApi } from "@/lib/api/endpoints";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import type { TreeItem, Vault } from "@/lib/api/types";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { type ExplorerSort, useWorkspaceStore } from "@/lib/stores/workspace-store";
import { PickerDialog } from "./picker-dialog";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 26;
const ROW_HEIGHT_TOUCH = 40;

interface ExplorerProps {
  vaultId: string;
  activeNoteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}

type FlatRow =
  | { kind: "folder"; id: string; name: string; depth: number; collapsed: boolean; path: string; color?: string }
  | { kind: "note"; id: string; title: string; depth: number; path: string; color?: string }
  | { kind: "create-input"; parentId: string | null; createKind: "note" | "folder"; depth: number };

/** Obsidian-ish swatches for colouring files and folders. */
const ITEM_COLORS = [
  { name: "Red", value: "#eb3b5a" },
  { name: "Orange", value: "#fa8231" },
  { name: "Yellow", value: "#f7b731" },
  { name: "Green", value: "#20bf6b" },
  { name: "Teal", value: "#0fb9b1" },
  { name: "Blue", value: "#2d98da" },
  { name: "Purple", value: "#8854d0" },
];

/** Colours are stored per vault as a flat {itemId: hex} map (no migration
 *  needed) — folders pass theirs down to descendants that set none. */
type ColorMap = Record<string, string>;

const SORT_LABELS: Record<ExplorerSort, string> = {
  "title-asc": "File name (A to Z)",
  "title-desc": "File name (Z to A)",
  "updated-desc": "Modified time (new to old)",
  "updated-asc": "Modified time (old to new)",
  "created-desc": "Created time (new to old)",
  "created-asc": "Created time (old to new)",
};

function sortNotes(notes: Extract<TreeItem, { type: "note" }>[], sort: ExplorerSort) {
  const copy = [...notes];
  copy.sort((a, b) => {
    switch (sort) {
      case "title-desc":
        return b.title.localeCompare(a.title);
      case "updated-desc":
        return b.updated_at.localeCompare(a.updated_at);
      case "updated-asc":
        return a.updated_at.localeCompare(b.updated_at);
      case "created-desc":
        return b.created_at.localeCompare(a.created_at);
      case "created-asc":
        return a.created_at.localeCompare(b.created_at);
      default:
        return a.title.localeCompare(b.title);
    }
  });
  return copy;
}

function flattenTree(
  items: TreeItem[],
  collapsed: Set<string>,
  creating: { kind: "note" | "folder"; parentId: string | null } | null,
  sort: ExplorerSort,
  depth = 0,
  parentId: string | null = null,
  colors: ColorMap = {},
  inherited: string | undefined = undefined,
  parentPath = "",
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const item of items) {
    if (item.type === "folder") {
      const isCollapsed = collapsed.has(item.id);
      // Own colour wins; otherwise keep carrying the nearest ancestor's down.
      const color = colors[item.id] ?? inherited;
      const path = parentPath ? `${parentPath}/${item.name}` : item.name;
      rows.push({ kind: "folder", id: item.id, name: item.name, depth, collapsed: isCollapsed, path, color });
      if (!isCollapsed) {
        rows.push(
          ...flattenTree(item.children, collapsed, creating, sort, depth + 1, item.id, colors, color, path),
        );
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
  const noteItems = items.filter((i): i is Extract<TreeItem, { type: "note" }> => i.type === "note");
  for (const item of sortNotes(noteItems, sort)) {
    rows.push({
      kind: "note",
      id: item.id,
      title: item.title,
      depth,
      path: parentPath ? `${parentPath}/${item.title}` : item.title,
      color: colors[item.id] ?? inherited,
    });
  }
  return rows;
}

/** Folder ids from the vault root down to the folder holding `noteId`.
 *  Empty when the note sits at the root or is not found. */
/** The active note of a pane layout — the explorer's selection follows it. */
function activeNoteIdOf(state: { panes: { tabs: { id: string; kind: string }[]; activeTabId: string | null }[]; activePane: number }): string | null {
  const pane = state.panes[state.activePane];
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
  return tab && tab.kind === "note" ? tab.id : null;
}

/** Folder ids from the root down to (but excluding) the target folder. */
function ancestorsOfFolder(items: TreeItem[], folderId: string, trail: string[] = []): string[] | null {
  for (const item of items) {
    if (item.type !== "folder") continue;
    if (item.id === folderId) return trail;
    const found = ancestorsOfFolder(item.children, folderId, [...trail, item.id]);
    if (found) return found;
  }
  return null;
}

function ancestorsOfNote(items: TreeItem[], noteId: string, trail: string[] = []): string[] | null {
  for (const item of items) {
    if (item.type === "note") {
      if (item.id === noteId) return trail;
      continue;
    }
    const found = ancestorsOfNote(item.children, noteId, [...trail, item.id]);
    if (found) return found;
  }
  return null;
}

/** Brief confirmation notice (the store's push defaults to the error style). */
function toast(message: string) {
  useToastStore.getState().push(message, "info");
}

/** Copy a vault-relative path; clipboard access can be denied, so report it. */
async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
    toast("Path copied");
  } catch {
    toastError(null, "Could not copy path.");
  }
}

/** Colour swatches + "None", shared by the file and folder menus. */
function ColorSubmenu({
  current,
  onPick,
}: {
  current?: string;
  onPick: (color: string | null) => void;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Colour</ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-40">
        {ITEM_COLORS.map((c) => (
          <ContextMenuItem key={c.value} onClick={() => onPick(c.value)}>
            <span
              aria-hidden
              className="mr-2 size-3 shrink-0 rounded-full"
              style={{ backgroundColor: c.value }}
            />
            {c.name}
            {current === c.value && <span className="ml-auto text-ob-faint">✓</span>}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onPick(null)}>None</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Tags submenu: pick from the vault's existing tags or type a new one. Tags
 *  are written to the note's frontmatter server-side, so prose is never edited. */
function TagSubmenu({
  vaultId,
  onAdd,
}: {
  vaultId: string;
  onAdd: (tag: string) => void;
}) {
  const { data: tags } = useQuery({
    queryKey: ["tags", vaultId],
    queryFn: () => searchApi.tags(vaultId),
  });
  const [draft, setDraft] = useState("");
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Tags</ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        <div className="p-1">
          <input
            value={draft}
            placeholder="New tag + Enter"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && draft.trim()) {
                onAdd(draft);
                setDraft("");
              }
            }}
            className="h-7 w-full rounded border border-ob-border bg-ob-bg px-2 text-[12px] text-ob-text outline-none placeholder:text-ob-faint focus:border-ob-accent"
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {(tags ?? []).slice(0, 60).map((t) => (
            <ContextMenuItem key={t.name} onClick={() => onAdd(t.name)}>
              <span className="truncate">#{t.name}</span>
              <span className="ml-auto text-ob-faint">{t.count}</span>
            </ContextMenuItem>
          ))}
          {(tags ?? []).length === 0 && (
            <p className="px-2 py-1.5 text-[12px] text-ob-faint">No tags yet.</p>
          )}
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Searchable picker used by "Move file to…" (folders) and "Merge entire file
 *  with…" (notes). Keeps both flows to one keyboard-friendly dialog. */

export function FileExplorer({ vaultId, activeNoteId, onOpenNote }: ExplorerProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The folder new notes/folders are created in. Clicking any row sets it, so
  // the toolbar buttons act "where you are" rather than always at the root.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; kind: "note" | "folder"; value: string } | null>(
    null,
  );
  const [creating, setCreating] = useState<{
    kind: "note" | "folder";
    parentId: string | null;
    value: string;
  } | null>(null);
  const explorerSort = useWorkspaceStore((s) => s.explorerSort);
  const setExplorerSort = useWorkspaceStore((s) => s.setExplorerSort);
  const openNoteBeside = useWorkspaceStore((s) => s.openNoteBeside);
  const activePane = useWorkspaceStore((s) => s.activePane);
  const setVersionsOpen = useWorkspaceStore((s) => s.setVersionsOpen);

  // Item colours live on the vault (settings.itemColors) so they follow the
  // vault across devices; a PATCH merges just that key.
  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const itemColors = useMemo<ColorMap>(() => {
    const v = vaults?.find((x) => x.id === vaultId);
    return ((v?.settings as { itemColors?: ColorMap } | undefined)?.itemColors ?? {}) as ColorMap;
  }, [vaults, vaultId]);
  const saveColors = useMutation({
    mutationFn: (next: ColorMap) => vaultApi.update(vaultId, { settings: { itemColors: next } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["vaults"], (old: Vault[] | undefined) =>
        old?.map((v) => (v.id === updated.id ? updated : v)),
      );
    },
    onError: (e) => toastError(e, "Could not save colour."),
  });
  const setItemColor = (id: string, color: string | null) => {
    const next = { ...itemColors };
    if (color) next[id] = color;
    else delete next[id];
    saveColors.mutate(next);
  };

  // "Move file to…" / "Merge entire file with…" open a picker dialog.
  const [moving, setMoving] = useState<{ noteId: string; title: string } | null>(null);
  const [merging, setMerging] = useState<{ noteId: string; title: string } | null>(null);

  const bookmark = useMutation({
    mutationFn: (noteId: string) => bookmarkApi.add(vaultId, noteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks", vaultId] });
      toast("Bookmarked");
    },
    onError: (e) => toastError(e, "Could not bookmark."),
  });

  const addTag = useMutation({
    mutationFn: ({ noteId, tag }: { noteId: string; tag: string }) =>
      noteApi.setTags(vaultId, noteId, { add: [tag] }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
      toast("Tag added");
    },
    onError: (e) => toastError(e, "Could not add tag."),
  });

  const duplicateNote = useMutation({
    mutationFn: async (noteId: string) => {
      const src = await noteApi.get(vaultId, noteId);
      // Find the next free suffix rather than always "<title> 1", which failed
      // with already_exists the second time you duplicated the same note.
      const taken = new Set(allItems.notes.map((n) => n.path.split("/").pop()));
      let title = `${src.title} 1`;
      for (let n = 1; taken.has(title); n++) title = `${src.title} ${n}`;
      return noteApi.create(vaultId, {
        title,
        folder_id: src.folder_id ?? null,
        content: src.content,
      });
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      onOpenNote(created.id, created.title);
    },
    onError: (e) => toastError(e, "Could not duplicate note."),
  });

  // Move: repoint the note at another folder (null = vault root).
  const moveNote = useMutation({
    mutationFn: ({ noteId, folderId }: { noteId: string; folderId: string | null }) =>
      noteApi.rename(vaultId, noteId, folderId ? { folder_id: folderId } : { move_to_root: true }),
    onSuccess: () => {
      setMoving(null);
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      toast("Moved");
    },
    onError: (e) => toastError(e, "Could not move note."),
  });

  // Merge: append the source's body to the target, then delete the source
  // (Obsidian's semantics).
  const mergeNote = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      const [source, target] = await Promise.all([
        noteApi.get(vaultId, sourceId),
        noteApi.get(vaultId, targetId),
      ]);
      const merged = `${target.content.trimEnd()}\n\n${source.content.trimStart()}`;
      await noteApi.saveContent(vaultId, targetId, merged, target.updated_at);
      await noteApi.remove(vaultId, sourceId);
      return target;
    },
    onSuccess: (target) => {
      setMerging(null);
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, target.id] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      onOpenNote(target.id, target.title);
      toast("Merged");
    },
    onError: (e) => toastError(e, "Could not merge notes."),
  });

  const rows = useMemo(
    () =>
      tree
        ? flattenTree(
            tree.items,
            collapsed,
            creating ? { kind: creating.kind, parentId: creating.parentId } : null,
            explorerSort,
            0,
            null,
            itemColors,
          )
        : [],
    [tree, collapsed, creating, explorerSort, itemColors],
  );

  const isMobile = useIsMobile();
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isMobile ? ROW_HEIGHT_TOUCH : ROW_HEIGHT),
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
    onSuccess: (_res, id) => {
      // Obsidian closes the file's view on delete — drop the tab everywhere
      useWorkspaceStore.getState().closeTab(id);
      invalidate();
    },
    onError: (err) => toastError(err, "Could not delete note."),
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => folderApi.remove(vaultId, id),
    onSuccess: invalidate,
    onError: (err) => toastError(err, "Could not delete folder."),
  });

  /** Every folder id in the vault, so collapse-all reaches nested folders too
   *  (the flattened rows only contain folders that are currently visible). */
  const allFolderIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (items: TreeItem[]) => {
      for (const item of items) {
        if (item.type === "folder") {
          ids.push(item.id);
          walk(item.children);
        }
      }
    };
    if (tree) walk(tree.items);
    return ids;
  }, [tree]);

  const allCollapsed = allFolderIds.length > 0 && allFolderIds.every((id) => collapsed.has(id));

  /** Every folder and note with its full path, independent of what is expanded.
   *  The pickers must offer the WHOLE vault — building them from the visible
   *  rows silently hid every target inside a collapsed folder. */
  const allItems = useMemo(() => {
    const folders: { id: string; path: string }[] = [];
    const notes: { id: string; path: string }[] = [];
    const walk = (items: TreeItem[], prefix: string) => {
      for (const item of items) {
        if (item.type === "folder") {
          const path = prefix ? `${prefix}/${item.name}` : item.name;
          folders.push({ id: item.id, path });
          walk(item.children, path);
        } else {
          notes.push({ id: item.id, path: prefix ? `${prefix}/${item.title}` : item.title });
        }
      }
    };
    if (tree) walk(tree.items, "");
    return { folders, notes };
  }, [tree]);

  /** Ancestor chain of the note currently open, for reveal + default location. */
  const activeAncestors = useMemo(
    () => (tree && activeNoteId ? (ancestorsOfNote(tree.items, activeNoteId) ?? []) : []),
    [tree, activeNoteId],
  );

  // Explicit click wins; otherwise inherit the open note's folder (Obsidian's
  // "same folder as current file"); otherwise the vault root.
  const createParentId = selectedFolderId ?? activeAncestors.at(-1) ?? null;

  /** Create a note/folder in the current location, revealing it first so the
   *  name input is actually on screen. */
  const startCreate = (kind: "note" | "folder") => {
    if (createParentId) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const id of [...activeAncestors, createParentId]) next.delete(id);
        return next;
      });
    }
    setCreating({ kind, parentId: createParentId, value: "" });
  };

  /** Obsidian's "reveal active file": expand only the path to the open note. */
  const revealActive = () => {
    if (!activeNoteId) return;
    const keep = new Set(activeAncestors);
    setCollapsed(new Set(allFolderIds.filter((id) => !keep.has(id))));
  };

  // ── Reveal on navigate ───────────────────────────────────────────────────
  //
  // Opening a note by ANY route (wikilink, graph, palette, backlink) selects
  // it in the explorer: expand its folders, then scroll the row into view.
  //
  // Driven by a store subscription rather than an effect on activeNoteId: this
  // is a reaction to an event, so the state update happens in a callback and
  // never during render. It also lets the "Reveal file in navigation" command
  // re-target the SAME note, which a value-diffing effect would ignore.
  const revealRef = useRef<{ noteId: string | null }>({ noteId: null });
  revealRef.current.noteId = activeNoteId;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  /** Expand the chain to an item, then scroll it into view once laid out. */
  const revealItem = useCallback((id: string, ancestors: string[]) => {
    setCollapsed((prev) => {
      if (ancestors.every((a) => !prev.has(a))) return prev; // already open
      const next = new Set(prev);
      for (const a of ancestors) next.delete(a);
      return next;
    });
    // Two frames: one for the state flush, one for the virtualizer to measure
    // the rows the newly-expanded folders added.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const index = rowsRef.current.findIndex((r) => "id" in r && r.id === id);
        if (index >= 0) virtualizerRef.current.scrollToIndex(index, { align: "auto" });
      }),
    );
  }, []);

  useEffect(() => {
    const reveal = (target: { kind: "note" | "folder"; id: string } | null) => {
      const current = treeRef.current;
      if (!target || !current) return;
      // A note is revealed by opening the folders ABOVE it. A folder is
      // revealed by opening those AND itself — otherwise "reveal Cabinet"
      // scrolls to a still-closed folder and shows none of its contents.
      const chain =
        target.kind === "note"
          ? (ancestorsOfNote(current.items, target.id) ?? [])
          : [...(ancestorsOfFolder(current.items, target.id) ?? []), target.id];
      revealItem(target.id, chain);
    };
    // Explicit requests ("Reveal file in navigation", a breadcrumb crumb).
    const unsub = useWorkspaceStore.subscribe((state, prev) => {
      if (state.revealTarget !== prev.revealTarget) reveal(state.revealTarget);
      const noteId = activeNoteIdOf(state);
      if (noteId && noteId !== activeNoteIdOf(prev)) reveal({ kind: "note", id: noteId });
    });
    return unsub;
  }, [revealItem]);

  /** One button that collapses everything, then expands everything back. */
  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(allFolderIds));

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
    <div className="flex h-full flex-col" role="tree" aria-label="File explorer">
      <div className="flex items-center gap-0.5 px-2 py-1.5">
        <button
          type="button"
          aria-label="New note"
          onClick={() => startCreate("note")}
          className="flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
        >
          <FilePlus2 className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="New folder"
          onClick={() => startCreate("folder")}
          className="flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
        >
          <FolderPlus className="size-4" strokeWidth={1.75} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Change sort order"
              className="flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
            >
              <ArrowUpDown className="size-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup
              value={explorerSort}
              onValueChange={(v) => setExplorerSort(v as ExplorerSort)}
            >
              {(Object.keys(SORT_LABELS) as ExplorerSort[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {SORT_LABELS[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          aria-label="Reveal active note"
          title="Show the open note, collapse everything else"
          onClick={revealActive}
          disabled={!activeNoteId}
          className="ml-auto flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <LocateFixed className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={allCollapsed ? "Expand all" : "Collapse all"}
          title={allCollapsed ? "Expand all" : "Collapse all"}
          onClick={toggleAll}
          disabled={allFolderIds.length === 0}
          className="flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {allCollapsed ? (
            <ChevronsUpDown className="size-4" strokeWidth={1.75} />
          ) : (
            <ChevronsDownUp className="size-4" strokeWidth={1.75} />
          )}
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
                        onClick={() => {
                          setSelectedFolderId(row.id);
                          toggleFolder(row.id);
                        }}
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
                          <span className="truncate font-medium" style={row.color ? { color: row.color } : undefined}>
                            {row.name}
                          </span>
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
                      <ColorSubmenu
                        current={itemColors[row.id]}
                        onPick={(c) => setItemColor(row.id, c)}
                      />
                      <ContextMenuItem onClick={() => void copyPath(row.path)}>
                        Copy path
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => setRenaming({ id: row.id, kind: "folder", value: row.name })}
                      >
                        Rename…
                      </ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() =>
                          void confirmDelete(
                            `Delete the folder “${row.name}” and everything inside it?`,
                          ).then((ok) => ok && deleteFolder.mutate(row.id))
                        }
                      >
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
                        // Addressable selection state: "which note is selected"
                        // is otherwise only expressed as a background colour.
                        data-note-id={row.id}
                        data-active={activeNoteId === row.id ? "" : undefined}
                        draggable
                        onDragStart={(e) => {
                          // Dropping a note into an editor should link it, so
                          // carry the wikilink as the plain-text payload and a
                          // private type the editor can recognise unambiguously.
                          e.dataTransfer.setData("text/plain", `[[${row.title}]]`);
                          e.dataTransfer.setData(
                            "application/x-nodum-note",
                            JSON.stringify({ id: row.id, title: row.title, path: row.path }),
                          );
                          e.dataTransfer.effectAllowed = "copyLink";
                        }}
                        onClick={() => {
                          // new items should land beside the file you just picked
                          const parent = row.path.includes("/")
                            ? (tree ? ancestorsOfNote(tree.items, row.id)?.at(-1) ?? null : null)
                            : null;
                          setSelectedFolderId(parent);
                          onOpenNote(row.id, row.title);
                        }}
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
                          <span className="truncate" style={row.color ? { color: row.color } : undefined}>
                            {row.title}
                          </span>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      <ContextMenuItem onClick={() => onOpenNote(row.id, row.title)}>
                        Open in new tab
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          openNoteBeside({ id: row.id, kind: "note", title: row.title }, activePane)
                        }
                      >
                        Open to the right
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          window.open(`/vault/${vaultId}?note=${row.id}`, "_blank", "noopener")
                        }
                      >
                        Open in new window
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => duplicateNote.mutate(row.id)}>
                        Duplicate
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => setMoving({ noteId: row.id, title: row.title })}>
                        Move file to…
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => bookmark.mutate(row.id)}>
                        Bookmark
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => setMerging({ noteId: row.id, title: row.title })}>
                        Merge entire file with…
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <TagSubmenu
                        vaultId={vaultId}
                        onAdd={(tag) => addTag.mutate({ noteId: row.id, tag })}
                      />
                      <ColorSubmenu
                        current={itemColors[row.id]}
                        onPick={(c) => setItemColor(row.id, c)}
                      />
                      <ContextMenuItem onClick={() => void copyPath(row.path)}>
                        Copy path
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          onOpenNote(row.id, row.title);
                          setVersionsOpen(true);
                        }}
                      >
                        Open version history
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => setRenaming({ id: row.id, kind: "note", value: row.title })}
                      >
                        Rename…
                      </ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() =>
                          void confirmDelete(`Delete “${row.title}”?`).then(
                            (ok) => ok && deleteNote.mutate(row.id),
                          )
                        }
                      >
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

      {moving && (
        <PickerDialog
          title={`Move “${moving.title}” to…`}
          emptyLabel="No folders match."
          items={[
            { id: null, label: "(vault root)" },
            ...allItems.folders.map((f) => ({ id: f.id, label: f.path })),
          ]}
          onPick={(folderId) => moveNote.mutate({ noteId: moving.noteId, folderId })}
          onClose={() => setMoving(null)}
        />
      )}
      {merging && (
        <PickerDialog
          title={`Merge “${merging.title}” into…`}
          emptyLabel="No other notes match."
          items={allItems.notes
            .filter((n) => n.id !== merging.noteId)
            .map((n) => ({ id: n.id, label: n.path }))}
          onPick={(targetId) =>
            targetId && mergeNote.mutate({ sourceId: merging.noteId, targetId })
          }
          onClose={() => setMerging(null)}
        />
      )}
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
