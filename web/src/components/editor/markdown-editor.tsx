"use client";

/** CodeMirror 6 markdown editor — mounted manually per DECISIONS.md §1.1. */

import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { tagCompletion, wikiLinkCompletion } from "@/lib/editor/autocomplete";
import { livePreview } from "@/lib/editor/live-preview";
import { nodumMarkdownExtensions } from "@/lib/editor/markdown-extensions";
import { nodumEditorTheme } from "@/lib/editor/theme";

export interface MarkdownEditorProps {
  vaultId: string;
  initialContent: string;
  mode: "live" | "source";
  onChange: (content: string) => void;
  onNavigate: (target: string) => void;
}

export function MarkdownEditor({
  vaultId,
  initialContent,
  mode,
  onChange,
  onNavigate,
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
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
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
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];

    if (mode === "live") {
      extensions.push(livePreview({ onNavigate: (t) => onNavigateRef.current(t), vaultId }));
    }

    const view = new EditorView({
      state: EditorState.create({ doc: initialContent, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when the note identity or mode changes — content updates
    // flow through the editor itself; external resets use the key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vaultId]);

  return <div ref={containerRef} className="min-h-[60vh]" />;
}
