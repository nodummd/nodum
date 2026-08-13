/** CodeMirror theme matching Obsidian's editor (colors from CSS variables). */

import { EditorView } from "@codemirror/view";

export const nodumEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--ob-text-normal)",
      fontSize: "var(--editor-font-size, 16px)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-content": {
      fontFamily: "var(--font-interface)",
      lineHeight: "1.6",
      padding: "0 0 40vh 0",
      caretColor: "var(--ob-text-normal)",
    },
    ".cm-line": { padding: "0" },
    ".cm-cursor": { borderLeftColor: "var(--ob-text-normal)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--ob-text-selection) !important",
    },
    ".cm-scroller": { fontFamily: "var(--font-interface)", overflow: "visible" },

    // Headings (Obsidian's minor-third scale)
    ".cm-h": { fontWeight: "700", lineHeight: "1.3" },
    ".cm-h1": { fontSize: "1.802em" },
    ".cm-h2": { fontSize: "1.602em" },
    ".cm-h3": { fontSize: "1.424em" },
    ".cm-h4": { fontSize: "1.266em" },
    ".cm-h5": { fontSize: "1.125em" },
    ".cm-h6": { fontSize: "1em", color: "var(--ob-text-muted)" },

    // Inline formatting
    ".cm-strong": { fontWeight: "700" },
    ".cm-em": { fontStyle: "italic" },
    ".cm-strike": { textDecoration: "line-through", color: "var(--ob-text-muted)" },
    ".cm-highlight": {
      backgroundColor: "hsla(254, 80%, 68%, 0.25)",
      borderRadius: "2px",
    },
    ".cm-inline-code": {
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: "0.9em",
      backgroundColor: "var(--ob-color-base-25)",
      borderRadius: "4px",
      padding: "1px 4px",
    },

    // Links
    ".cm-wikilink": {
      color: "var(--ob-link-color)",
      cursor: "pointer",
    },
    ".cm-wikilink:hover": { textDecoration: "underline" },
    ".cm-md-link": { color: "var(--ob-link-color)" },
    ".cm-hashtag": {
      color: "var(--ob-interactive-accent)",
      backgroundColor: "var(--ob-tag-background)",
      borderRadius: "999px",
      padding: "1px 8px",
      fontSize: "0.85em",
    },

    // Tasks & lists
    ".cm-task-checkbox": {
      appearance: "auto",
      accentColor: "var(--ob-interactive-accent)",
      width: "14px",
      height: "14px",
      margin: "0 2px",
      verticalAlign: "middle",
      cursor: "pointer",
    },
    ".cm-task-done": {
      color: "var(--ob-text-muted)",
      textDecoration: "line-through",
    },
    ".cm-list-bullet": { color: "var(--ob-interactive-accent)" },

    // Blocks
    ".cm-blockquote-line": {
      borderLeft: "2px solid var(--ob-interactive-accent)",
      paddingLeft: "12px !important",
      color: "var(--ob-text-muted)",
    },
    ".cm-codeblock-line": {
      backgroundColor: "var(--ob-color-base-25)",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: "0.9em",
    },

    // Autocomplete popup
    ".cm-tooltip": {
      backgroundColor: "var(--ob-color-base-25)",
      border: "1px solid var(--ob-background-modifier-border)",
      borderRadius: "8px",
      color: "var(--ob-text-normal)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      padding: "3px 8px",
      fontSize: "13px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--ob-background-modifier-hover)",
      color: "var(--ob-text-normal)",
    },
  },
  { dark: true },
);
