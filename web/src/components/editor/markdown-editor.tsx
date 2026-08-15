"use client";

/** CodeMirror 6 markdown editor — mounted manually per DECISIONS.md §1.1. */

import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { tagCompletion, wikiLinkCompletion } from "@/lib/editor/autocomplete";
import { insertLink, toggleBold, toggleHighlightCmd, toggleItalic } from "@/lib/editor/format-commands";
import { blockWidgets } from "@/lib/editor/block-widgets";
import { collabExtension, type CollabSession } from "@/lib/editor/collab";
import { livePreview } from "@/lib/editor/live-preview";
import { nodumMarkdownExtensions } from "@/lib/editor/markdown-extensions";
import { nodumEditorTheme } from "@/lib/editor/theme";

export interface MarkdownEditorProps {
  vaultId: string;
  initialContent: string;
  mode: "live" | "source";
  onChange: (content: string) => void;
  onNavigate: (target: string) => void;
  /** When set, the doc binds to the Yjs session (parent remounts by key). */
  collab?: CollabSession;
  /** User editor prefs (S11.2) — gutter line numbers + native spellcheck. */
  showLineNumbers?: boolean;
  spellcheck?: boolean;
}

export function MarkdownEditor({
  vaultId,
  initialContent,
  mode,
  onChange,
  onNavigate,
  collab,
  showLineNumbers = false,
  spellcheck = false,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onNavigateRef = useRef(onNavigate);

  useEffect(() => {
    onChangeRef.current = onChange;
    onNavigateRef.current = onNavigate;
  }, [onChange, onNavigate]);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      history(),
      keymap.of([
        // Obsidian formatting hotkeys take precedence over the defaults
        { key: "Mod-b", run: toggleBold },
        { key: "Mod-i", run: toggleItalic },
        { key: "Mod-k", run: insertLink },
        { key: "Mod-Shift-h", run: toggleHighlightCmd },
        // ⌘[ / ⌘] are Obsidian's navigate back/forward. CodeMirror's
        // defaultKeymap binds them to indentLess/indentMore, so without this
        // the chord would BOTH indent the line and navigate. Returning true
        // consumes the key (no indent); CM doesn't stop propagation, so the
        // window-level hotkey listener still navigates.
        { key: "Mod-[", run: () => true },
        { key: "Mod-]", run: () => true },
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
      EditorView.contentAttributes.of({ spellcheck: String(spellcheck) }),
      ...(showLineNumbers ? [lineNumbers()] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];

    if (mode === "live") {
      extensions.push(livePreview({ onNavigate: (t) => onNavigateRef.current(t), vaultId }));
      extensions.push(blockWidgets());
    }

    if (collab) extensions.push(collabExtension(collab));

    const view = new EditorView({
      state: EditorState.create({
        doc: collab ? collab.ytext.toString() : initialContent,
        extensions,
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when the note identity, mode, or editor prefs change —
    // content updates flow through the editor itself; external resets use the
    // key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vaultId, showLineNumbers, spellcheck]);

  return <div ref={containerRef} className="min-h-[60vh]" />;
}
