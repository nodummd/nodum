/** Formatting commands — Obsidian's ⌘B / ⌘I / ⌘K editor hotkeys. */

import type { StateCommand } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";

/** Shrink a range so it excludes leading/trailing whitespace.
 *
 *  Select-all (or a triple-click) includes the trailing newline; wrapping that
 *  literally produces `**text\n**`, which markdown does not read as bold. Every
 *  inline wrapper works on the trimmed span instead, as Obsidian does. */
function trimRange(state: EditorStateLike, from: number, to: number): { from: number; to: number } {
  const text = state.sliceDoc(from, to);
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  // All-whitespace: leave it alone so the caret case still inserts markers.
  if (lead + trail >= text.length) return { from, to };
  return { from: from + lead, to: to - trail };
}

type EditorStateLike = { sliceDoc: (from: number, to: number) => string };

/** Toggle a symmetric inline wrapper (e.g. ** for bold) around each selection. */
function toggleWrap(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((raw) => {
      const range = { ...raw, ...trimRange(state, raw.from, raw.to) };
      const selected = state.sliceDoc(range.from, range.to);
      // The user selected the markers along with the text (`**bold**`). Without
      // this branch we'd wrap again and produce `****bold****`.
      if (
        selected.length >= marker.length * 2 &&
        selected.startsWith(marker) &&
        selected.endsWith(marker)
      ) {
        return {
          changes: [
            { from: range.from, to: range.from + marker.length },
            { from: range.to - marker.length, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - marker.length * 2),
        };
      }

      const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from);
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length));
      // `*` is a prefix of `**`: italicising the inner text of `**bold**` would
      // otherwise see a `*` on each side, "unwrap" it, and silently demote the
      // bold to italic. Only treat it as wrapped when the neighbouring run of
      // marker characters is exactly this marker.
      const runChar = marker[0];
      const outerBefore = state.sliceDoc(
        Math.max(0, range.from - marker.length - 1),
        Math.max(0, range.from - marker.length),
      );
      const outerAfter = state.sliceDoc(
        Math.min(state.doc.length, range.to + marker.length),
        Math.min(state.doc.length, range.to + marker.length + 1),
      );
      const ambiguous = outerBefore === runChar || outerAfter === runChar;

      if (before === marker && after === marker && !ambiguous) {
        // unwrap
        return {
          changes: [
            { from: range.from - marker.length, to: range.from },
            { from: range.to, to: range.to + marker.length },
          ],
          range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
        };
      }
      // wrap
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
      };
    });
    dispatch(state.update(changes, { userEvent: "input.format" }));
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleHighlightCmd = toggleWrap("==");

/** ⌘K — wrap the selection as a markdown link [text](url), cursor in the url. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      // place the cursor between the () — ready to paste a URL
      range: EditorSelection.cursor(range.from + insert.length - 1),
    };
  });
  dispatch(state.update(changes, { userEvent: "input.format" }));
  return true;
};

export const toggleStrikethrough = toggleWrap("~~");
export const toggleInlineCode = toggleWrap("`");

/** Toggle an asymmetric wrapper — used for the things markdown has no syntax
 *  for. Obsidian renders inline HTML in both reading and live-preview mode, so
 *  `<u>`, `<sup>` and coloured `<span>`s are the native way to express these. */
function toggleTags(open: string, close: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((raw) => {
      const range = { ...raw, ...trimRange(state, raw.from, raw.to) };
      const selected = state.sliceDoc(range.from, range.to);
      if (selected.startsWith(open) && selected.endsWith(close)) {
        return {
          changes: [
            { from: range.from, to: range.from + open.length },
            { from: range.to - close.length, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - open.length - close.length),
        };
      }
      const before = state.sliceDoc(Math.max(0, range.from - open.length), range.from);
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + close.length));
      if (before === open && after === close) {
        return {
          changes: [
            { from: range.from - open.length, to: range.from },
            { from: range.to, to: range.to + close.length },
          ],
          range: EditorSelection.range(range.from - open.length, range.to - open.length),
        };
      }
      return {
        changes: { from: range.from, to: range.to, insert: open + selected + close },
        range: EditorSelection.range(range.from + open.length, range.from + open.length + selected.length),
      };
    });
    dispatch(state.update(changes, { userEvent: "input.format" }));
    return true;
  };
}

export const toggleUnderline = toggleTags("<u>", "</u>");
export const toggleSuperscript = toggleTags("<sup>", "</sup>");
export const toggleSubscript = toggleTags("<sub>", "</sub>");

/** Obsidian's colour palette (Settings → Appearance accent swatches). */
export const TEXT_COLORS: { name: string; value: string }[] = [
  { name: "Red", value: "#e93147" },
  { name: "Orange", value: "#ec7500" },
  { name: "Yellow", value: "#e0ac00" },
  { name: "Green", value: "#08b94e" },
  { name: "Cyan", value: "#00bfbc" },
  { name: "Blue", value: "#086ddd" },
  { name: "Purple", value: "#7852ee" },
  { name: "Pink", value: "#d53984" },
];

/** Markdown has no colour syntax; an inline span is what Obsidian itself uses. */
export function setTextColor(value: string): StateCommand {
  return toggleTags(`<span style="color:${value}">`, "</span>");
}

export function setHighlightColor(value: string): StateCommand {
  return toggleTags(`<mark style="background:${value}">`, "</mark>");
}

/** Strip every inline marker from the selection — Obsidian's "clear formatting". */
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const plain = state
      .sliceDoc(range.from, range.to)
      .replace(/<\/?(?:u|sup|sub|span|mark)\b[^>]*>/gi, "")
      .replace(/(\*\*\*|\*\*|\*|__|_|~~|==|`)/g, "");
    return {
      changes: { from: range.from, to: range.to, insert: plain },
      range: EditorSelection.range(range.from, range.from + plain.length),
    };
  });
  dispatch(state.update(changes, { userEvent: "input.format" }));
  return true;
};

/** Apply an edit to every line touched by the selection, as ONE transaction.
 *  Omitting an explicit selection lets CodeMirror map the caret through the
 *  changes, which is what keeps multi-line toggles feeling native. */
function mapSelectedLines(
  edit: (line: { from: number; text: string }) => { from: number; to: number; insert: string } | null,
): StateCommand {
  return ({ state, dispatch }) => {
    const changes: { from: number; to: number; insert: string }[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = state.doc.line(n);
        const change = edit({ from: line.from, text: line.text });
        if (change) changes.push(change);
      }
    }
    if (changes.length === 0) return false;
    dispatch(state.update({ changes, userEvent: "input.format" }));
    return true;
  };
}

/** Obsidian's set-heading-0..6 — level 0 strips the heading. */
export function setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): StateCommand {
  return mapSelectedLines(({ from, text }) => {
    const m = /^(\s*)(#{1,6}\s+)?/.exec(text);
    if (!m) return null;
    const indent = m[1] ?? "";
    return {
      from: from + indent.length,
      to: from + (m[0]?.length ?? 0),
      insert: level ? `${"#".repeat(level)} ` : "",
    };
  });
}

/** Add/remove a fixed line prefix (quote, bullet, task). Toggles off when every
 *  touched line already carries it — matching how Obsidian's list toggles feel. */
function togglePrefix(prefix: string, pattern: RegExp): StateCommand {
  return ({ state, dispatch }) => {
    const lines: { from: number; text: string }[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = state.doc.line(n);
        lines.push({ from: line.from, text: line.text });
      }
    }
    if (lines.length === 0) return false;
    const allPrefixed = lines.every((l) => pattern.test(l.text));
    const changes = lines.map(({ from, text }) => {
      const indent = /^\s*/.exec(text)?.[0] ?? "";
      const existing = pattern.exec(text);
      return allPrefixed && existing
        ? { from: from + indent.length, to: from + existing[0].length, insert: "" }
        : { from: from + indent.length, to: from + indent.length, insert: prefix };
    });
    dispatch(state.update({ changes, userEvent: "input.format" }));
    return true;
  };
}

export const toggleBulletList = togglePrefix("- ", /^\s*[-*+]\s+/);
export const toggleNumberedList = togglePrefix("1. ", /^\s*\d+[.)]\s+/);
export const toggleTaskList = togglePrefix("- [ ] ", /^\s*[-*+]\s+\[[ xX]\]\s+/);
export const toggleBlockquote = togglePrefix("> ", /^\s*>\s?/);

/** Insert a block at the cursor, starting on its own line. */
function insertBlock(build: (selected: string) => { text: string; caretOffset: number }): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const line = state.doc.lineAt(range.from);
      const lead = line.from === range.from ? "" : "\n";
      const { text, caretOffset } = build(state.sliceDoc(range.from, range.to));
      const insert = lead + text;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + lead.length + caretOffset),
      };
    });
    dispatch(state.update(changes, { userEvent: "input.format" }));
    return true;
  };
}

export const insertCodeBlock = insertBlock((selected) => ({
  // Caret parks right after the opening fence so the language can be typed.
  text: "```\n" + selected + "\n```\n",
  caretOffset: 3,
}));

export const insertHorizontalRule = insertBlock(() => ({ text: "\n---\n\n", caretOffset: 6 }));

export const insertCallout = insertBlock((selected) => ({
  text: "> [!note]\n> " + (selected || "") + "\n\n",
  caretOffset: 3, // inside [!note] so the type can be changed immediately
}));

/** A GFM table sized rows × cols, with the caret in the first header cell. */
export function insertTable(rows = 2, cols = 3): StateCommand {
  return insertBlock(() => {
    const header = `| ${Array(cols).fill("Column").map((c, i) => `${c} ${i + 1}`).join(" | ")} |`;
    const divider = `| ${Array(cols).fill("---").join(" | ")} |`;
    const body = Array(rows)
      .fill(`| ${Array(cols).fill("   ").join(" | ")} |`)
      .join("\n");
    return { text: `${header}\n${divider}\n${body}\n\n`, caretOffset: 2 };
  });
}

export const CALLOUT_TYPES = [
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;

export function insertCalloutOfType(type: string): StateCommand {
  return insertBlock((selected) => ({
    text: `> [!${type}]\n> ${selected || ""}\n\n`,
    caretOffset: type.length + 6, // end of the title line
  }));
}

export const insertFootnote: StateCommand = ({ state, dispatch }) => {
  // Number the new note one past the highest existing marker so repeated use
  // doesn't collide.
  const existing = [...state.doc.toString().matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  const n = (existing.length ? Math.max(...existing) : 0) + 1;
  const at = state.selection.main.head;
  const end = state.doc.length;
  dispatch(
    state.update({
      changes: [
        { from: at, insert: `[^${n}]` },
        { from: end, insert: `\n\n[^${n}]: ` },
      ],
      selection: EditorSelection.cursor(end + `\n\n[^${n}]: `.length + `[^${n}]`.length),
      userEvent: "input.format",
    }),
  );
  return true;
};

export const insertMathBlock = insertBlock((selected) => ({
  text: "$$\n" + selected + "\n$$\n\n",
  caretOffset: 3,
}));

export const insertMermaid = insertBlock(() => ({
  text: "```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n\n",
  caretOffset: 11,
}));

/** Insert plain text at the caret (dates, tags, wikilinks). */
function insertText(build: (selected: string) => { text: string; caretOffset?: number }): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const { text, caretOffset } = build(state.sliceDoc(range.from, range.to));
      return {
        changes: { from: range.from, to: range.to, insert: text },
        range: EditorSelection.cursor(range.from + (caretOffset ?? text.length)),
      };
    });
    dispatch(state.update(changes, { userEvent: "input.format" }));
    return true;
  };
}

export const insertWikilink = insertText((s) => ({ text: `[[${s}]]`, caretOffset: 2 + s.length }));
export const insertEmbed = insertText((s) => ({ text: `![[${s}]]`, caretOffset: 3 + s.length }));
export const insertTag = insertText((s) => ({ text: `#${s}` }));
export const insertDate = insertText(() => ({ text: new Date().toISOString().slice(0, 10) }));
export const insertTime = insertText(() => ({
  text: new Date().toTimeString().slice(0, 5),
}));

// ── Line operations ────────────────────────────────────────────────────────

/** Rewrite the lines the selection touches. Operates on whole lines, so a
 *  caret with no selection sorts nothing — matching Obsidian's behaviour. */
function transformLines(fn: (lines: string[]) => string[]): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    if (first.number === last.number) return false;
    const lines = state.sliceDoc(first.from, last.to).split("\n");
    const next = fn(lines).join("\n");
    dispatch(
      state.update({
        changes: { from: first.from, to: last.to, insert: next },
        selection: EditorSelection.range(first.from, first.from + next.length),
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

// localeCompare so "Ápple" sorts next to "Apple" rather than after "Zebra".
const byText = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { numeric: true });

export const sortLinesAsc = transformLines((l) => [...l].sort(byText));
export const sortLinesDesc = transformLines((l) => [...l].sort((a, b) => byText(b, a)));
export const reverseLines = transformLines((l) => [...l].reverse());
export const dedupeLines = transformLines((l) => [...new Set(l)]);
export const joinLines = transformLines((l) => [l.map((x) => x.trim()).join(" ")]);

/** Indent / outdent by one level, list-aware (Obsidian's Tab / Shift-Tab). */
export const indentLines = mapSelectedLines(({ from }) => ({ from, to: from, insert: "\t" }));
export const outdentLines = mapSelectedLines(({ from, text }) => {
  const m = /^(\t| {1,4})/.exec(text);
  return m ? { from, to: from + m[0].length, insert: "" } : null;
});

/** Flip `- [ ]` ↔ `- [x]` on every touched task line. */
export const toggleCheckbox = mapSelectedLines(({ from, text }) => {
  const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(text);
  if (!m) return null;
  const at = from + m[1].length;
  return { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " };
});

/** Obsidian's "Add file property" — ensure a frontmatter block and put the
 *  caret on a fresh key line inside it. */
export const addFileProperty: StateCommand = ({ state, dispatch }) => {
  const doc = state.doc.toString();
  if (doc.startsWith("---\n")) {
    const end = doc.indexOf("\n---", 4);
    if (end > 0) {
      // Append a key just before the closing fence.
      const at = end + 1;
      dispatch(
        state.update({
          changes: { from: at, insert: "key: value\n" },
          selection: EditorSelection.range(at, at + 3),
          userEvent: "input.format",
        }),
      );
      return true;
    }
  }
  const block = "---\nkey: value\n---\n\n";
  dispatch(
    state.update({
      changes: { from: 0, insert: block },
      selection: EditorSelection.range(4, 7), // select "key"
      userEvent: "input.format",
    }),
  );
  return true;
};
