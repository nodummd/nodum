"use client";

/**
 * The per-note "⋯" menu — Obsidian's tab/file menu, at the top right of the
 * editor.
 *
 * Two of Obsidian's entries are desktop-only and deliberately absent: "Reveal
 * in Finder" and "Open in default app" address a file on disk, and a note here
 * is a database row. "Export to PDF" goes through the browser's own print
 * pipeline, which is the web equivalent.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bookmarkApi, noteApi, vaultApi } from "@/lib/api/endpoints";
import type { Note, TreeItem } from "@/lib/api/types";
import { addFileProperty } from "@/lib/editor/format-commands";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { confirmDelete } from "./confirm-dialog";
import { PickerDialog } from "./picker-dialog";

/** Flatten the tree into pickable folders / notes with their full paths. */
function collect(items: TreeItem[], trail = ""): { folders: { id: string; label: string }[]; notes: { id: string; label: string }[] } {
  const folders: { id: string; label: string }[] = [];
  const notes: { id: string; label: string }[] = [];
  for (const item of items) {
    const label = trail ? `${trail}/${item.type === "folder" ? item.name : item.title}` : item.type === "folder" ? item.name : item.title;
    if (item.type === "folder") {
      folders.push({ id: item.id, label });
      const nested = collect(item.children, label);
      folders.push(...nested.folders);
      notes.push(...nested.notes);
    } else {
      notes.push({ id: item.id, label });
    }
  }
  return { folders, notes };
}

export function NoteMenu({
  vaultId,
  note,
  paneIndex,
  getEditorView,
  onRenameRequest,
  backlinksInDocument,
  onToggleBacklinksInDocument,
}: {
  vaultId: string;
  note: Note;
  paneIndex: number;
  /** The live CodeMirror view, for the commands that edit the document. */
  getEditorView: () => EditorView | null;
  /** Focus + select the inline title field (Obsidian's "Rename…"). */
  onRenameRequest: () => void;
  backlinksInDocument: boolean;
  onToggleBacklinksInDocument: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const setMode = useWorkspaceStore((s) => s.setEditorMode);
  const openNoteBeside = useWorkspaceStore((s) => s.openNoteBeside);
  const setSplitOrientation = useWorkspaceStore((s) => s.setSplitOrientation);
  const setVersionsOpen = useWorkspaceStore((s) => s.setVersionsOpen);
  const setRightPane = useWorkspaceStore((s) => s.setRightPane);
  const rightSidebarOpen = useWorkspaceStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useWorkspaceStore((s) => s.toggleRightSidebar);
  const leftSidebarOpen = useWorkspaceStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useWorkspaceStore((s) => s.toggleLeftSidebar);
  const setLeftPane = useWorkspaceStore((s) => s.setLeftPane);
  const revealNote = useWorkspaceStore((s) => s.revealNote);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const [picker, setPicker] = useState<"move" | "merge" | null>(null);
  // Set by the commands that move focus somewhere deliberate. Radix returns
  // focus to the trigger when the menu closes, which lands AFTER our own
  // focus() call and silently undoes it.
  const claimsFocus = useRef(false);

  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
    enabled: picker !== null,
  });
  const { data: bookmarks } = useQuery({
    queryKey: ["bookmarks", vaultId],
    queryFn: () => bookmarkApi.list(vaultId),
  });
  const isBookmarked = Boolean(bookmarks?.some((b) => b.note_id === note.id));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
    void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
  };

  const move = useMutation({
    mutationFn: (folderId: string | null) =>
      noteApi.rename(vaultId, note.id, folderId === null ? { move_to_root: true } : { folder_id: folderId }),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
      toast("Moved");
    },
    onError: (e) => toastError(e, "Could not move the note."),
  });

  const merge = useMutation({
    mutationFn: async (sourceId: string) => {
      // Append the OTHER note's body to this one, then delete it — Obsidian's
      // "Merge entire file with…" leaves you standing in the merge target.
      const source = await noteApi.get(vaultId, sourceId);
      const combined = `${note.content.trimEnd()}\n\n${source.content.trimStart()}`;
      await noteApi.saveContent(vaultId, note.id, combined, note.updated_at);
      await noteApi.remove(vaultId, sourceId);
      return sourceId;
    },
    onSuccess: (sourceId) => {
      closeTab(sourceId);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
      toast("Merged");
    },
    onError: (e) => toastError(e, "Could not merge the notes."),
  });

  const toggleBookmark = useMutation({
    mutationFn: () =>
      isBookmarked ? bookmarkApi.remove(vaultId, note.id) : bookmarkApi.add(vaultId, note.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks", vaultId] });
      toast(isBookmarked ? "Bookmark removed" : "Bookmarked");
    },
    onError: (e) => toastError(e, "Could not update the bookmark."),
  });

  const remove = useMutation({
    mutationFn: () => noteApi.remove(vaultId, note.id),
    onSuccess: () => {
      closeTab(note.id);
      invalidate();
      toast("Note deleted");
    },
    onError: (e) => toastError(e, "Could not delete the note."),
  });

  /** Run a command against the live editor, then hand focus back to it.
   *
   *  Reading view has no CodeMirror instance at all, so these commands used to
   *  silently do nothing there — a menu item that looks live and isn't. Switch
   *  to the editor first and wait for it to mount, as Obsidian does. */
  const inEditor = (fn: (view: EditorView) => void) => () => {
    const view = getEditorView();
    if (view) {
      fn(view);
      view.focus();
      return;
    }
    setMode("live");
    // The view is created by an effect after this render commits; poll a few
    // frames for it rather than guessing at a timeout.
    let frames = 0;
    const wait = () => {
      const mounted = getEditorView();
      if (mounted) {
        fn(mounted);
        mounted.focus();
        return;
      }
      if (frames++ < 60) requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  };

  /** Open the search panel and put the caret in one of its two fields.
   *  Without this, "Find…" and "Replace…" are the same command and neither
   *  leaves you anywhere useful — focus returns to the menu trigger. */
  const openSearch = (field: "search" | "replace") => () => {
    claimsFocus.current = true;
    inEditor((view) => {
      openSearchPanel(view);
      requestAnimationFrame(() => {
        const panel = view.dom.querySelector(".cm-search");
        const input = panel?.querySelector<HTMLInputElement>(
          field === "search" ? 'input[name="search"]' : 'input[name="replace"]',
        );
        input?.focus();
        input?.select();
      });
    })();
  };

  /** Print the note. Reading view first: it renders the whole document, while
   *  CodeMirror only builds the lines near the viewport, so printing from the
   *  editor drops everything below the fold on a long note. */
  const exportToPdf = () => {
    setMode("reading");
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const openInNewWindow = () => {
    window.open(`/vault/${vaultId}?note=${note.id}`, "_blank", "noopener,noreferrer");
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(note.path);
      toast("Path copied");
    } catch {
      toast("Could not copy the path");
    }
  };

  const showPanel = (pane: "backlinks" | "outgoing") => {
    setRightPane(pane);
    if (!rightSidebarOpen) toggleRightSidebar();
  };

  const revealInNavigation = () => {
    setLeftPane("files");
    if (!leftSidebarOpen) toggleLeftSidebar();
    revealNote(note.id);
  };

  const del = async () => {
    if (await confirmDelete(`Delete “${note.title}”?`)) {
      remove.mutate();
    }
  };

  const picked = tree ? collect(tree.items) : { folders: [], notes: [] };

  return (
    <>
      <DropdownMenu>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More options"
                className="flex size-6 items-center justify-center rounded text-ob-faint transition-colors duration-150 hover:bg-ob-hover hover:text-ob-text"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">More options</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={(e) => {
            if (!claimsFocus.current) return;
            claimsFocus.current = false;
            e.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={onToggleBacklinksInDocument}>
            {backlinksInDocument ? "Hide backlinks in document" : "Backlinks in document"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("reading")}>Reading view</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("source")}>Source mode</DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => {
              setSplitOrientation("row");
              openNoteBeside({ id: note.id, kind: "note", title: note.title }, paneIndex);
            }}
          >
            Split right
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setSplitOrientation("column");
              openNoteBeside({ id: note.id, kind: "note", title: note.title }, paneIndex);
            }}
          >
            Split down
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openInNewWindow}>Open in new window</DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => {
              // Same focus race as Find/Replace: without the claim, Radix
              // returns focus to the trigger and the title never gets it.
              claimsFocus.current = true;
              onRenameRequest();
            }}
          >
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicker("move")}>Move file to…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleBookmark.mutate()}>
            {isBookmarked ? "Remove bookmark" : "Bookmark"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicker("merge")}>Merge entire file with…</DropdownMenuItem>
          <DropdownMenuItem onSelect={inEditor((v) => addFileProperty(v))}>
            Add file property
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToPdf}>Export to PDF…</DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={openSearch("search")}>Find…</DropdownMenuItem>
          <DropdownMenuItem onSelect={openSearch("replace")}>Replace…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyPath()}>Copy path</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setVersionsOpen(true)}>Open version history</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => showPanel("outgoing")}>Open linked view</DropdownMenuItem>
          <DropdownMenuItem onSelect={revealInNavigation}>Reveal file in navigation</DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem variant="destructive" onSelect={() => void del()}>
            Delete file
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {picker === "move" && (
        <PickerDialog
          title="Move file to…"
          items={[{ id: null, label: "Vault root" }, ...picked.folders]}
          emptyLabel="No folders yet."
          onPick={(id) => {
            setPicker(null);
            move.mutate(id);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "merge" && (
        <PickerDialog
          title="Merge entire file with…"
          items={picked.notes.filter((n) => n.id !== note.id)}
          emptyLabel="No other notes."
          onPick={(id) => {
            setPicker(null);
            if (id) merge.mutate(id);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}
