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
import { useState, type ReactNode } from "react";

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
  actions,
  children,
}: {
  /** The live editor. A getter, because the view is created after mount. */
  getView: () => EditorView | null;
  actions?: EditorContextMenuActions;
  children: ReactNode;
}) {
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

  // Nothing sampled yet (menu never opened): render everything unchecked.
  const f = ctx.formats ?? EMPTY_ACTIVE;

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
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

        <ContextMenuSeparator />
        <Item
          label="Find…"
          shortcut="⌘F"
          onSelect={() => {
            const view = getView();
            if (view) openSearchPanel(view);
          }}
        />
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
    </ContextMenu>
  );
}
