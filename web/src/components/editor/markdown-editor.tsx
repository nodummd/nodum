"use client";

/** CodeMirror 6 markdown editor — mounted manually per DECISIONS.md §1.1. */

import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyField, historyKeymap, redo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { tagCompletion, wikiLinkCompletion } from "@/lib/editor/autocomplete";
import {
  insertLink,
  toggleBold,
  toggleHighlightCmd,
  toggleItalic,
  toggleUnderline,
} from "@/lib/editor/format-commands";
import { blockWidgets } from "@/lib/editor/block-widgets";
import { collabExtension, type CollabSession } from "@/lib/editor/collab";
import { livePreview } from "@/lib/editor/live-preview";
import { nodumMarkdownExtensions } from "@/lib/editor/markdown-extensions";
import { EditorContextMenu, type EditorContextMenuActions } from "@/components/editor/editor-context-menu";
import { attachmentUpload } from "@/lib/editor/attachment-upload";
import { nodumEditorTheme } from "@/lib/editor/theme";

/** Undo history outlives the editor. `workspace.tsx` renders only the active
 *  tab, so switching away unmounts the editor; without this the next mount
 *  started with an empty history and ⌘Z did nothing after a tab switch. The
 *  snapshot is keyed by pane AND note (splitRight can show one note in two
 *  panes, each with its own caret and its own undo stack) and guarded by the
 *  exact document it was taken from — a snapshot of a different document
 *  would undo into the wrong text. Bounded so a long session cannot grow it
 *  without limit. */
interface HistorySnapshot {
  json: unknown;
  doc: string;
}
const HISTORY_CACHE_LIMIT = 24;
const historyCache = new Map<string, HistorySnapshot>();

function rememberHistory(key: string, state: EditorState) {
  historyCache.delete(key);
  historyCache.set(key, { json: state.toJSON({ history: historyField }), doc: state.doc.toString() });
  while (historyCache.size > HISTORY_CACHE_LIMIT) {
    const oldest = historyCache.keys().next().value;
    if (oldest === undefined) break;
    historyCache.delete(oldest);
  }
}

/** Test hook: how many history snapshots are held. */
export function historySnapshotCount(): number {
  return historyCache.size;
}

export interface MarkdownEditorProps {
  vaultId: string;
  /** Pane + note identity for the undo-history snapshot; omit to never keep one. */
  historyKey?: string;
  initialContent: string;
  mode: "live" | "source";
  onChange: (content: string) => void;
  onNavigate: (target: string, opts?: { newTab?: boolean; heading?: string }) => void;
  /** When set, the doc binds to the Yjs session (parent remounts by key). */
  collab?: CollabSession;
  /** Extra right-click actions that need workspace context (new note, extract). */
  menuActions?: EditorContextMenuActions;
  /** Receives the live view so the pane's ⋯ menu can run editor commands. */
  onViewReady?: (view: EditorView | null) => void;
  /** User editor prefs (S11.2) — gutter line numbers + native spellcheck. */
  showLineNumbers?: boolean;
  spellcheck?: boolean;
}

export function MarkdownEditor({
  vaultId,
  historyKey,
  initialContent,
  mode,
  onChange,
  onNavigate,
  collab,
  menuActions,
  onViewReady,
  showLineNumbers = false,
  spellcheck = false,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onNavigateRef = useRef(onNavigate);
  const onViewReadyRef = useRef(onViewReady);

  useEffect(() => {
    onChangeRef.current = onChange;
    onNavigateRef.current = onNavigate;
    onViewReadyRef.current = onViewReady;
  }, [onChange, onNavigate, onViewReady]);

  // Mode and editor prefs are Compartments: reconfiguring keeps the whole
  // EditorState — history, selection, scroll — where a remount would not.
  const modeCompartment = useRef(new Compartment()).current;
  const gutterCompartment = useRef(new Compartment()).current;
  const spellcheckCompartment = useRef(new Compartment()).current;

  const modeExtensions = (m: "live" | "source") =>
    m === "live"
      ? [livePreview({ onNavigate: (t, opts) => onNavigateRef.current(t, opts), vaultId }), blockWidgets()]
      : [];

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      attachmentUpload(vaultId),
      // Keeps the selection highlighted while focus is in the context menu —
      // the native selection clears as soon as the menu takes focus.
      drawSelection(),
      history(),
      keymap.of([
        // Obsidian formatting hotkeys take precedence over the defaults
        { key: "Mod-b", run: toggleBold },
        { key: "Mod-i", run: toggleItalic },
        { key: "Mod-k", run: insertLink },
        { key: "Mod-Shift-h", run: toggleHighlightCmd },
        // ⌘U is underline (Obsidian) — deliberately ahead of historyKeymap's
        // undoSelection, which is the less useful of the two.
        { key: "Mod-u", run: toggleUnderline },
        // ⌘E is "toggle reading view" (workspace hotkey, Hotkeys tab, docs) —
        // it must not also wrap the selection in backticks; inline code is
        // on the context menu.
        // ⌘[ / ⌘] are Obsidian's navigate back/forward. CodeMirror's
        // defaultKeymap binds them to indentLess/indentMore, so without this
        // the chord would BOTH indent the line and navigate. Returning true
        // consumes the key (no indent); CM doesn't stop propagation, so the
        // window-level hotkey listener still navigates.
        { key: "Mod-[", run: () => true },
        { key: "Mod-]", run: () => true },
        // Redo on every platform: historyKeymap gives macOS ⌘⇧Z, Linux both
        // Ctrl-Shift-Z and Ctrl-Y — and Windows Ctrl-Y only. Ctrl-Shift-Z is
        // what most Windows hands reach for.
        { key: "Ctrl-Shift-z", run: redo },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      markdown({
        base: markdownLanguage,
        extensions: nodumMarkdownExtensions,
      }),
      closeBrackets(),
      autocompletion({
        override: [wikiLinkCompletion(vaultId), tagCompletion(vaultId)],
        activateOnTyping: true,
      }),
      nodumEditorTheme,
      placeholder("Start writing…"),
      EditorView.lineWrapping,
      spellcheckCompartment.of(EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })),
      gutterCompartment.of(showLineNumbers ? lineNumbers() : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
      modeCompartment.of(modeExtensions(mode)),
    ];

    if (collab) extensions.push(collabExtension(collab));

    const doc = collab ? collab.ytext.toString() : initialContent;
    const snapshot = historyKey ? historyCache.get(historyKey) : undefined;
    let state: EditorState | null = null;
    if (snapshot && snapshot.doc === doc) {
      try {
        state = EditorState.fromJSON(snapshot.json as Parameters<typeof EditorState.fromJSON>[0], { extensions }, {
          history: historyField,
        });
      } catch {
        state = null; // a snapshot from an older build: start fresh
      }
    }
    const view = new EditorView({
      state: state ?? EditorState.create({ doc, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    onViewReadyRef.current?.(view);

    return () => {
      if (historyKey) rememberHistory(historyKey, view.state);
      view.destroy();
      viewRef.current = null;
      onViewReadyRef.current?.(null);
    };
    // Recreate only when the note identity changes — content updates flow
    // through the editor itself; external resets use the key prop; mode and
    // prefs reconfigure the live view below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, historyKey]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        gutterCompartment.reconfigure(showLineNumbers ? lineNumbers() : []),
        spellcheckCompartment.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLineNumbers, spellcheck]);

  // Right-clicking outside the selection moves the caret there first, so the
  // context menu acts on what the user pointed at. Clicking INSIDE a selection
  // leaves it alone — otherwise "select a phrase, right-click, Bold" would
  // collapse the selection and format nothing.
  //
  // This lives on the container, not in a CodeMirror domEventHandler: events
  // raised inside a replaced block widget (a rendered live-preview table) never
  // reach CodeMirror's handlers, and right-clicking a table you can see is
  // exactly when the table commands need to be reachable.
  const syncCaretToPointer = (event: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view) return;
    // `false` = never null: a widget click is not over text but still has a
    // nearest document position, and that position is inside the widget's range.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    const { from, to } = view.state.selection.main;
    if (pos < from || pos > to) view.dispatch({ selection: { anchor: pos } });
  };

  return (
    <EditorContextMenu getView={() => viewRef.current} vaultId={vaultId} actions={menuActions}>
      <div ref={containerRef} className="min-h-[60vh]" onContextMenu={syncCaretToPointer} />
    </EditorContextMenu>
  );
}
