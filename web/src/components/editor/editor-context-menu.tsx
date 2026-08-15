"use client";

/**
 * Right-click menu for the editor — Obsidian's formatting menu, plus the
 * table/line operations it exposes on a selection.
 *
 * Every action is an ordinary CodeMirror StateCommand, so the same code powers
 * the hotkeys, and every edit lands as a single undoable transaction.
 */

import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PickerDialog } from "@/components/workspace/picker-dialog";
import { attachmentApi, vaultApi } from "@/lib/api/endpoints";
import type { TreeItem } from "@/lib/api/types";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  activeFormats,
  addFileProperty,
  deleteSelection,
  insertExternalLink,
  insertTextAtSelection,
  insertVaultLink,
  toPlainText,
  CALLOUT_TYPES,
  clearFormatting,
  dedupeLines,
  indentLines,
  insertCalloutOfType,
  insertCodeBlock,
  insertDate,
  insertEmbed,
  insertFootnote,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertMermaid,
  insertTable,
  insertTag,
  insertTime,
  insertWikilink,
  joinLines,
  outdentLines,
  reverseLines,
  setHeading,
  setHighlightColor,
  setTextColor,
  sortLinesAsc,
  sortLinesDesc,
  TEXT_COLORS,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCheckbox,
  toggleHighlightCmd,
  toggleInlineCode,
  toggleItalic,
  toggleNumberedList,
  toggleStrikethrough,
  toggleSubscript,
  toggleSuperscript,
  toggleTaskList,
  toggleUnderline,
} from "@/lib/editor/format-commands";
import type { ActiveFormats } from "@/lib/editor/format-commands";
import {
  caretInTable,
  tableAlignColumn,
  tableDeleteColumn,
  tableDeleteRow,
  tableFormat,
  tableInsertColumnLeft,
  tableInsertColumnRight,
  tableInsertRowAbove,
  tableInsertRowBelow,
  tableSortByColumn,
} from "@/lib/editor/table-commands";

type Cmd = (view: EditorView) => boolean;

/** Every note in the vault, with its full path, for the link picker. */
function flattenNotes(items: TreeItem[], trail = ""): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const item of items) {
    const name = item.type === "folder" ? item.name : item.title;
    const label = trail ? `${trail}/${name}` : name;
    if (item.type === "folder") out.push(...flattenNotes(item.children, label));
    else out.push({ id: item.title, label });
  }
  return out;
}

/** A one-field dialog — used for "Add external link". */
function UrlDialog({ onSubmit, onClose }: { onSubmit: (url: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState("https://");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Add external link</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = url.trim();
            if (trimmed && trimmed !== "https://") onSubmit(trimmed);
          }}
        >
          <input
            autoFocus
            value={url}
            aria-label="Link URL"
            onChange={(e) => setUrl(e.target.value)}
            onFocus={(e) => e.currentTarget.setSelectionRange(url.length, url.length)}
            className="h-8 w-full rounded border border-ob-border bg-ob-bg px-2 text-[13px] text-ob-text outline-none placeholder:text-ob-faint focus:border-ob-accent"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_ACTIVE: ActiveFormats = {
  bold: false,
  italic: false,
  strikethrough: false,
  highlight: false,
  code: false,
  underline: false,
  heading: 0,
  bulletList: false,
  numberedList: false,
  taskList: false,
  quote: false,
};

/** One command row. Declared at module scope: a component created during
 *  render would remount (and lose state) on every parent render. */
function Item({
  label,
  shortcut,
  onSelect,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <ContextMenuItem onSelect={onSelect} disabled={disabled}>
      {label}
      {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
    </ContextMenuItem>
  );
}

/** A command that reports whether it is currently in effect. Rendered as a
 *  menuitemcheckbox so the state is exposed to assistive tech (and to tests),
 *  not just drawn as a tick. */
function ToggleItem({
  label,
  shortcut,
  checked,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenuCheckboxItem checked={checked} onSelect={onSelect}>
      {label}
      {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
    </ContextMenuCheckboxItem>
  );
}

/** A colour row with its swatch, so the palette is readable at a glance. */
function ColorItem({
  name,
  value,
  onSelect,
}: {
  name: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <ContextMenuItem onSelect={onSelect}>
      <span
        aria-hidden
        className="mr-2 inline-block size-3 rounded-full border border-border/50"
        style={{ background: value }}
      />
      {name}
    </ContextMenuItem>
  );
}

export interface EditorContextMenuActions {
  /** Create a new note (Obsidian's "+ New"). */
  onNewNote?: () => void;
  /** Create a new note whose title is the selected text and link to it. */
  onExtractSelection?: (text: string) => void;
}

export function EditorContextMenu({
  getView,
  vaultId,
  actions,
  children,
}: {
  /** The live editor. A getter, because the view is created after mount. */
  getView: () => EditorView | null;
  vaultId: string;
  actions?: EditorContextMenuActions;
  children: ReactNode;
}) {
  const toast = useToastStore((s) => s.push);
  const setLeftPane = useWorkspaceStore((s) => s.setLeftPane);
  const setSearchSeed = useWorkspaceStore((s) => s.setSearchSeed);
  const leftSidebarOpen = useWorkspaceStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useWorkspaceStore((s) => s.toggleLeftSidebar);

  /** "note" opens the vault picker, "url" the external-link dialog. */
  const [linking, setLinking] = useState<"note" | "url" | null>(null);

  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
    enabled: linking === "note",
  });
  const { data: attachments } = useQuery({
    queryKey: ["attachments", vaultId],
    queryFn: () => attachmentApi.list(vaultId),
    enabled: linking === "note",
  });
  // Sampled when the menu opens: the editor's selection is what the commands
  // will act on, and reading it during render would be a live-state read.
  const [ctx, setCtx] = useState<{
    inTable: boolean;
    hasSelection: boolean;
    selected: string;
    formats: ActiveFormats | null;
  }>({ inTable: false, hasSelection: false, selected: "", formats: null });

  /** Run a command against the editor and keep focus in the document —
   *  otherwise the caret is left in the (now closed) menu. */
  const run = (cmd: Cmd) => () => {
    const view = getView();
    if (!view) return;
    cmd(view);
    view.focus();
  };

  const onOpenChange = (open: boolean) => {
    if (!open) return;
    const view = getView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    setCtx({
      inTable: caretInTable(view.state),
      hasSelection: from !== to,
      selected: view.state.sliceDoc(from, to),
      formats: activeFormats(view.state),
    });
  };

  /** Send the selected words to the sidebar search pane. */
  const searchSelection = () => {
    setLeftPane("search");
    if (!leftSidebarOpen) toggleLeftSidebar();
    setSearchSeed(ctx.selected.trim());
  };

  /** Clipboard reads can be refused by the browser — Chrome asks for
   *  permission, Firefox declines outright — so failures are reported rather
   *  than swallowed. ⌘V always works regardless. */
  const paste = (plain: boolean) => async () => {
    const view = getView();
    if (!view) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      insertTextAtSelection(plain ? toPlainText(text) : text)(view);
      view.focus();
    } catch {
      toast("The browser would not let the editor read the clipboard — use ⌘V.");
    }
  };

  const copy = (cut: boolean) => async () => {
    const view = getView();
    if (!view || !ctx.selected) return;
    try {
      await navigator.clipboard.writeText(ctx.selected);
      if (cut) deleteSelection(view);
      view.focus();
    } catch (e) {
      toastError(e, "Could not write to the clipboard.");
    }
  };

  const linkTargets = [
    ...flattenNotes(tree?.items ?? []),
    ...(attachments ?? []).map((a) => ({ id: a.filename, label: a.filename })),
  ];

  // Nothing sampled yet (menu never opened): render everything unchecked.
  const f = ctx.formats ?? EMPTY_ACTIVE;
  const word = ctx.selected.trim().replace(/\s+/g, " ");
  const shortWord = word.length > 24 ? `${word.slice(0, 24)}…` : word;

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {/* 1 — what you do with the words you just selected. */}
        <Item label="Add link" onSelect={() => setLinking("note")} />
        <Item label="Add external link" onSelect={() => setLinking("url")} />
        <Item
          label={word ? `Search for “${shortWord}”` : "Search for…"}
          disabled={!word}
          onSelect={searchSelection}
        />

        <ContextMenuSeparator />

        {/* 2 — formatting. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>Format</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ToggleItem label="Bold" checked={f.bold} onSelect={run(toggleBold)} shortcut="⌘B" />
            <ToggleItem label="Italic" checked={f.italic} onSelect={run(toggleItalic)} shortcut="⌘I" />
            <ToggleItem
              label="Underline"
              checked={f.underline}
              onSelect={run(toggleUnderline)}
              shortcut="⌘U"
            />
            <ToggleItem
              label="Strikethrough"
              checked={f.strikethrough}
              onSelect={run(toggleStrikethrough)}
            />
            <ToggleItem
              label="Highlight"
              checked={f.highlight}
              onSelect={run(toggleHighlightCmd)}
              shortcut="⌘⇧H"
            />
            <ContextMenuSeparator />
            <Item label="Superscript" onSelect={run(toggleSuperscript)} />
            <Item label="Subscript" onSelect={run(toggleSubscript)} />
            <ToggleItem
              label="Inline code"
              checked={f.code}
              onSelect={run(toggleInlineCode)}
              shortcut="⌘E"
            />
            <Item label="Code block" onSelect={run(insertCodeBlock)} />
            <ContextMenuSeparator />
            <Item label="Clear formatting" onSelect={run(clearFormatting)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Text colour</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {TEXT_COLORS.map((c) => (
              <ColorItem key={c.value} name={c.name} value={c.value} onSelect={run(setTextColor(c.value))} />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Highlight colour</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {TEXT_COLORS.map((c) => (
              <ColorItem
                key={c.value}
                name={c.name}
                value={c.value}
                onSelect={run(setHighlightColor(c.value))}
              />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Paragraph</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ToggleItem label="Plain text" checked={f.heading === 0} onSelect={run(setHeading(0))} />
            <ContextMenuSeparator />
            {([1, 2, 3, 4, 5, 6] as const).map((level) => (
              <ToggleItem
                key={level}
                label={`Heading ${String(level)}`}
                checked={f.heading === level}
                shortcut={`⌘${String(level)}`}
                onSelect={run(setHeading(level))}
              />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Lists</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ToggleItem label="Bullet list" checked={f.bulletList} onSelect={run(toggleBulletList)} />
            <ToggleItem
              label="Numbered list"
              checked={f.numberedList}
              onSelect={run(toggleNumberedList)}
            />
            <ToggleItem label="Task list" checked={f.taskList} onSelect={run(toggleTaskList)} />
            <Item label="Toggle checkbox" onSelect={run(toggleCheckbox)} shortcut="⌘⏎" />
            <ContextMenuSeparator />
            <ToggleItem label="Blockquote" checked={f.quote} onSelect={run(toggleBlockquote)} />
            <ContextMenuSeparator />
            <Item label="Indent" onSelect={run(indentLines)} shortcut="⇥" />
            <Item label="Outdent" onSelect={run(outdentLines)} shortcut="⇧⇥" />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Insert</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <Item label="Link" onSelect={run(insertLink)} shortcut="⌘K" />
            <Item label="Wikilink" onSelect={run(insertWikilink)} shortcut="[[" />
            <Item label="Embed" onSelect={run(insertEmbed)} />
            <Item label="Tag" onSelect={run(insertTag)} />
            <ContextMenuSeparator />
            <Item label="Table" onSelect={run(insertTable())} />
            <Item label="Horizontal rule" onSelect={run(insertHorizontalRule)} />
            <Item label="Footnote" onSelect={run(insertFootnote)} />
            <Item label="Math block" onSelect={run(insertMathBlock)} />
            <Item label="Mermaid diagram" onSelect={run(insertMermaid)} />
            <ContextMenuSeparator />
            <Item label="Today's date" onSelect={run(insertDate)} />
            <Item label="Current time" onSelect={run(insertTime)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>Callout</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 w-44 overflow-y-auto">
            {CALLOUT_TYPES.map((type) => (
              <ContextMenuItem key={type} onSelect={run(insertCalloutOfType(type))} className="capitalize">
                {type}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          {/* Never gated: "Table" is where people look to CREATE one. Gating the
              whole group made the obvious entry point dead. Only the operations
              that need an existing table are disabled. */}
          <ContextMenuSubTrigger>Table</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <Item label="Insert table" onSelect={run(insertTable())} />
            <ContextMenuSeparator />
            <Item label="Insert row above" disabled={!ctx.inTable} onSelect={run(tableInsertRowAbove)} />
            <Item label="Insert row below" disabled={!ctx.inTable} onSelect={run(tableInsertRowBelow)} />
            <Item label="Delete row" disabled={!ctx.inTable} onSelect={run(tableDeleteRow)} />
            <ContextMenuSeparator />
            <Item label="Insert column left" disabled={!ctx.inTable} onSelect={run(tableInsertColumnLeft)} />
            <Item label="Insert column right" disabled={!ctx.inTable} onSelect={run(tableInsertColumnRight)} />
            <Item label="Delete column" disabled={!ctx.inTable} onSelect={run(tableDeleteColumn)} />
            <ContextMenuSeparator />
            <Item label="Align left" disabled={!ctx.inTable} onSelect={run(tableAlignColumn("left"))} />
            <Item label="Align centre" disabled={!ctx.inTable} onSelect={run(tableAlignColumn("center"))} />
            <Item label="Align right" disabled={!ctx.inTable} onSelect={run(tableAlignColumn("right"))} />
            <ContextMenuSeparator />
            <Item label="Sort column A → Z" disabled={!ctx.inTable} onSelect={run(tableSortByColumn("asc"))} />
            <Item label="Sort column Z → A" disabled={!ctx.inTable} onSelect={run(tableSortByColumn("desc"))} />
            <Item label="Format table" disabled={!ctx.inTable} onSelect={run(tableFormat)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!ctx.hasSelection}>Sort &amp; filter lines</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <Item label="Sort A → Z" onSelect={run(sortLinesAsc)} />
            <Item label="Sort Z → A" onSelect={run(sortLinesDesc)} />
            <Item label="Reverse" onSelect={run(reverseLines)} />
            <ContextMenuSeparator />
            <Item label="Remove duplicates" onSelect={run(dedupeLines)} />
            <Item label="Join into one line" onSelect={run(joinLines)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>Properties</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <Item label="Add file property" onSelect={run(addFileProperty)} />
          </ContextMenuSubContent>
        </ContextMenuSub>

        {actions?.onNewNote && <Item label="New note" onSelect={actions.onNewNote} shortcut="⌘N" />}
        {actions?.onExtractSelection && (
          <Item
            label="New note from selection"
            disabled={!ctx.hasSelection}
            onSelect={() => actions.onExtractSelection?.(ctx.selected)}
          />
        )}

        <Item
          label="Find…"
          shortcut="⌘F"
          onSelect={() => {
            const view = getView();
            if (view) openSearchPanel(view);
          }}
        />

        <ContextMenuSeparator />

        {/* 3 — clipboard. */}
        <Item label="Cut" shortcut="⌘X" disabled={!ctx.hasSelection} onSelect={() => void copy(true)()} />
        <Item label="Copy" shortcut="⌘C" disabled={!ctx.hasSelection} onSelect={() => void copy(false)()} />
        <Item label="Paste" shortcut="⌘V" onSelect={() => void paste(false)()} />
        <Item label="Paste in plain text" shortcut="⌘⇧V" onSelect={() => void paste(true)()} />
        <ContextMenuItem
          onSelect={() => {
            const view = getView();
            if (!view) return;
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
            view.focus();
          }}
        >
          Select all
          <ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>

      {linking === "note" && (
        <PickerDialog
          title="Link to a note or file"
          items={linkTargets}
          emptyLabel="Nothing to link to yet."
          onPick={(id) => {
            setLinking(null);
            const view = getView();
            if (!view || !id) return;
            insertVaultLink(id)(view);
            view.focus();
          }}
          onClose={() => setLinking(null)}
        />
      )}
      {linking === "url" && (
        <UrlDialog
          onSubmit={(url) => {
            setLinking(null);
            const view = getView();
            if (!view) return;
            insertExternalLink(url)(view);
            view.focus();
          }}
          onClose={() => setLinking(null)}
        />
      )}
    </ContextMenu>
  );
}
