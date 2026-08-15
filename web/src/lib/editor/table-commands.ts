/**
 * GFM table editing — the row/column/alignment operations Obsidian exposes on
 * a table under the cursor.
 *
 * A table is found by walking outward from the caret's line while lines still
 * look like table rows, so the commands work wherever the caret sits inside it
 * and are inert (return false) everywhere else.
 */

import type { StateCommand } from "@codemirror/state";
import { EditorSelection, type EditorState } from "@codemirror/state";

import {
  type Align,
  alignOf,
  alignSpec,
  cellWidth,
  escapeCell,
  isDivider,
  isRow,
  splitCells,
  splitRow,
} from "./table-model";

interface Table {
  /** Document offsets of the whole table block. */
  from: number;
  to: number;
  /** Cell text per row, divider excluded. Row 0 is the header. */
  rows: string[][];
  aligns: Align[];
  /** Caret position within the table, for row/column-relative commands. */
  row: number;
  col: number;
}

// Parsing lives in table-model.ts so the widget and the commands cannot
// disagree about where a cell starts — see the escaped-pipe note there.

function findTable(state: EditorState): Table | null {
  const caret = state.selection.main.head;
  const here = state.doc.lineAt(caret);
  if (!isRow(here.text)) return null;

  let first = here.number;
  while (first > 1 && isRow(state.doc.line(first - 1).text)) first--;
  let last = here.number;
  while (last < state.doc.lines && isRow(state.doc.line(last + 1).text)) last++;

  const rows: string[][] = [];
  let aligns: Align[] = [];
  let caretRow = 0;
  let sawDivider = false;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (isDivider(line.text)) {
      sawDivider = true;
      aligns = splitRow(line.text).map(alignOf);
      continue;
    }
    if (n <= here.number) caretRow = rows.length;
    rows.push(splitRow(line.text));
  }
  if (rows.length === 0) return null;
  // A GFM table REQUIRES the `| --- |` delimiter row. Without this check any
  // prose line containing pipes reads as a one-row table, and the row/column
  // commands then rewrite it — destructively.
  if (!sawDivider) return null;

  // Column index = which cell span the caret falls in. Counting pipes would
  // count ESCAPED ones too, putting the caret in the wrong column of any table
  // whose cells contain `\|`.
  const offset = caret - here.from;
  const spans = splitCells(here.text);
  let col = 0;
  for (let i = 0; i < spans.length; i++) {
    if (offset >= spans[i].from) col = i;
  }
  col = Math.max(0, Math.min(col, (rows[0]?.length ?? 1) - 1));

  return {
    from: state.doc.line(first).from,
    to: state.doc.line(last).to,
    rows,
    aligns,
    row: caretRow,
    col,
  };
}

/** Re-emit the table with every column padded to its widest cell. */
function render(rows: string[][], aligns: Align[]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    // Pad on DISPLAY width: `a \| b` occupies 6 source characters but 5 visual
    // ones, and padding on the source length makes the columns drift.
    widths[c] = Math.max(3, ...rows.map((r) => cellWidth(r[c] ?? "")));
  }
  const line = (cells: string[]) =>
    `| ${Array.from({ length: cols }, (_, c) => {
      const cell = escapeCell(cells[c] ?? "");
      return cell + " ".repeat(Math.max(0, widths[c] - cellWidth(cell)));
    }).join(" | ")} |`;
  const divider = `| ${Array.from({ length: cols }, (_, c) => alignSpec(aligns[c] ?? "none", widths[c])).join(" | ")} |`;
  const [header, ...body] = rows;
  return [line(header ?? []), divider, ...body.map(line)].join("\n");
}

/** Build a table command from a pure transform over the parsed table. */
function tableCommand(
  edit: (t: Table) => { rows: string[][]; aligns: Align[] } | null,
): StateCommand {
  return ({ state, dispatch }) => {
    const table = findTable(state);
    if (!table) return false;
    const next = edit(table);
    if (!next) return false;
    const text = render(next.rows, next.aligns);
    dispatch(
      state.update({
        changes: { from: table.from, to: table.to, insert: text },
        selection: EditorSelection.cursor(table.from),
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

const emptyRow = (cols: number) => Array.from({ length: cols }, () => "   ");

export const tableInsertRowAbove = tableCommand((t) => {
  // Never above the header — a GFM table's first row IS the header.
  const at = Math.max(1, t.row);
  const rows = [...t.rows];
  rows.splice(at, 0, emptyRow(t.rows[0]?.length ?? 1));
  return { rows, aligns: t.aligns };
});

export const tableInsertRowBelow = tableCommand((t) => {
  const rows = [...t.rows];
  rows.splice(t.row + 1, 0, emptyRow(t.rows[0]?.length ?? 1));
  return { rows, aligns: t.aligns };
});

export const tableDeleteRow = tableCommand((t) => {
  if (t.rows.length <= 1 || t.row === 0) return null; // keep the header
  const rows = t.rows.filter((_, i) => i !== t.row);
  return { rows, aligns: t.aligns };
});

function insertColumn(offset: 0 | 1): StateCommand {
  return tableCommand((t) => {
    const at = t.col + offset;
    const rows = t.rows.map((r, i) => {
      const next = [...r];
      next.splice(at, 0, i === 0 ? "New column" : "   ");
      return next;
    });
    const aligns = [...t.aligns];
    aligns.splice(at, 0, "none");
    return { rows, aligns };
  });
}

export const tableInsertColumnLeft = insertColumn(0);
export const tableInsertColumnRight = insertColumn(1);

export const tableDeleteColumn = tableCommand((t) => {
  if ((t.rows[0]?.length ?? 0) <= 1) return null;
  const rows = t.rows.map((r) => r.filter((_, i) => i !== t.col));
  return { rows, aligns: t.aligns.filter((_, i) => i !== t.col) };
});

export function tableAlignColumn(align: Align): StateCommand {
  return tableCommand((t) => {
    const aligns = [...t.aligns];
    while (aligns.length < (t.rows[0]?.length ?? 0)) aligns.push("none");
    aligns[t.col] = align;
    return { rows: t.rows, aligns };
  });
}

/** Pad every column to an even width — Obsidian's "Format table". */
export const tableFormat = tableCommand((t) => ({ rows: t.rows, aligns: t.aligns }));

/** Sort the body rows by the caret's column, header pinned in place. */
export function tableSortByColumn(direction: "asc" | "desc"): StateCommand {
  return tableCommand((t) => {
    const [header, ...body] = t.rows;
    if (!header || body.length < 2) return null;
    const sorted = [...body].sort((a, b) => {
      const cmp = (a[t.col] ?? "").localeCompare(b[t.col] ?? "", undefined, { numeric: true });
      return direction === "asc" ? cmp : -cmp;
    });
    return { rows: [header, ...sorted], aligns: t.aligns };
  });
}

/** True when the caret sits inside a table — used to enable the menu group. */
export function caretInTable(state: EditorState): boolean {
  return findTable(state) !== null;
}
