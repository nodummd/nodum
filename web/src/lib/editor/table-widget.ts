/**
 * An editable table in live preview.
 *
 * The rendered `<table>` is a block widget, but its cells are contenteditable
 * islands: you type into the table you can see, and each keystroke becomes a
 * minimal change over exactly that cell's span in the markdown source.
 *
 * Why this is safe rather than a fight with CodeMirror, verified against
 * @codemirror/view 6.43.x:
 *
 * - `DOMObserver.readMutation` returns null for any mutation inside a widget,
 *   so CodeMirror never tries to interpret our cell edits as document input.
 * - `DocView.updateSelection` early-returns unless the content DOM itself has
 *   focus. While a cell holds focus, CodeMirror does not write the DOM
 *   selection, so the caret cannot be yanked out from under the user.
 * - `TileCache.findWidget` offers `updateDOM` the existing node and reuses it
 *   when we return true — the same element, so focus and caret survive a
 *   decoration rebuild.
 * - `ignoreEvent` returning true makes `eventBelongsToEditor` drop the event,
 *   which keeps defaultKeymap, closeBrackets and autocompletion out of a cell.
 */

import { isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { ySyncFacet } from "y-codemirror.next";

import { presenceColor } from "./collab";
import {
  findTable,
  focusTableCell,
  render,
  tableCellSpans,
  withTableAnchor,
  tableDeleteColumn,
  tableDeleteRow,
  tableInsertColumnRight,
  tableInsertRowBelow,
  tableMoveRowDown,
  tableMoveRowUp,
} from "./table-commands";
import {
  type Align,
  alignOf,
  escapeCell,
  isDivider,
  renderCellHTML,
  splitCells,
  unescapeCell,
} from "./table-model";

interface DomState {
  /** True while reconcile() is writing; every handler bails, because a
   *  dispatch during EditorView.update throws. */
  reconciling: boolean;
  composing: boolean;
  /** "row:col" of the last edited cell, for undo isolation. */
  lastCell: string | null;
  /** Collab: the awareness listener that tints peers' cells, for removal. */
  awarenessOff: (() => void) | null;
}

const DOM_STATE = new WeakMap<HTMLElement, DomState>();

function domState(dom: HTMLElement): DomState {
  let st = DOM_STATE.get(dom);
  if (!st) {
    st = { reconciling: false, composing: false, lastCell: null, awarenessOff: null };
    DOM_STATE.set(dom, st);
  }
  return st;
}

interface ParsedSource {
  cells: string[][];
  aligns: Align[];
}

/** Parse the block's raw markdown the same way the commands do. */
function parseSource(source: string): ParsedSource {
  const cells: string[][] = [];
  let aligns: Align[] = [];
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    if (isDivider(line)) {
      aligns = splitCells(line).map((c) => alignOf(c.text));
      continue;
    }
    const row = splitCells(line);
    if (row.length) cells.push(row.map((c) => c.text));
  }
  return { cells, aligns };
}

const cellAt = (dom: HTMLElement, row: number, col: number) =>
  dom.querySelector<HTMLElement>(`[data-table-cell][data-table-row="${row}"][data-table-col="${col}"]`);

function caretOffsetIn(cell: HTMLElement): number {
  const sel = cell.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(cell);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length;
}

function setCaretOffset(cell: HTMLElement, offset: number): void {
  const doc = cell.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const node = cell.firstChild ?? cell;
  const max = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").length : 0;
  const range = doc.createRange();
  if (node.nodeType === Node.TEXT_NODE) range.setStart(node, Math.min(offset, max));
  // An empty cell has no text node to offset into, so anchor to its contents.
  // The comma-operator `range.collapse(false)` that used to live here was dead:
  // the unconditional collapse(true) below immediately overrode it.
  else range.selectNodeContents(cell);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Show a cell's raw markdown so it can be typed on. */
function toRaw(cell: HTMLElement): void {
  if (cell.dataset.raw === "1") return;
  cell.dataset.raw = "1";
  cell.textContent = unescapeCell(cell.dataset.src ?? "");
}

/** Show a cell's rendered inline markdown (`**a**` as bold). */
function toRendered(cell: HTMLElement): void {
  cell.dataset.raw = "0";
  cell.innerHTML = renderCellHTML(unescapeCell(cell.dataset.src ?? ""));
}

function applyAlign(cell: HTMLElement, align: Align): void {
  cell.style.textAlign = align === "none" ? "" : align;
}

function scaffold(id: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cm-table-widget nodum-table-editable";
  wrap.dataset.nodumTable = "";
  wrap.dataset.tableId = String(id);

  const table = document.createElement("table");
  table.appendChild(document.createElement("thead"));
  table.appendChild(document.createElement("tbody"));
  wrap.appendChild(table);

  const bar = document.createElement("div");
  bar.className = "nodum-table-toolbar";
  for (const [label, action] of [
    ["Add row", "add-row"],
    ["Add column", "add-column"],
    ["Move row up", "move-row-up"],
    ["Move row down", "move-row-down"],
    ["Delete row", "delete-row"],
    ["Delete column", "delete-column"],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tableControl = action;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.textContent = label;
    bar.appendChild(b);
  }
  wrap.appendChild(bar);
  return wrap;
}

/** Rebuild the grid to `rows` × `cols`, preserving nothing — callers only do
 *  this when the shape actually changed. */
function rebuildGrid(dom: HTMLElement, rows: number, cols: number): void {
  const table = dom.querySelector("table")!;
  const thead = table.tHead!;
  const tbody = table.tBodies[0];
  thead.replaceChildren();
  tbody.replaceChildren();

  const makeCell = (r: number, c: number, header: boolean) => {
    const cell = document.createElement(header ? "th" : "td");
    cell.dataset.tableCell = "";
    cell.dataset.tableRow = String(r);
    cell.dataset.tableCol = String(c);
    cell.contentEditable = "true";
    cell.spellcheck = false;
    return cell;
  };

  const headRow = document.createElement("tr");
  for (let c = 0; c < cols; c++) headRow.appendChild(makeCell(0, c, true));
  thead.appendChild(headRow);

  for (let r = 1; r < rows; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < cols; c++) tr.appendChild(makeCell(r, c, false));
    tbody.appendChild(tr);
  }

  dom.dataset.rows = String(rows);
  dom.dataset.cols = String(cols);
}

/**
 * Bring the DOM in line with the source.
 *
 * The invariant that makes typing work: the cell the user is in is never
 * written while the document already agrees with it. Writing it would collapse
 * the caret to offset 0 on every keystroke.
 */
function reconcile(dom: HTMLElement, view: EditorView, source: string): void {
  const st = domState(dom);
  const { cells, aligns } = parseSource(source);
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  const active = view.root.activeElement as HTMLElement | null;
  const focused = active?.closest?.("[data-table-cell]") ?? null;
  const shapeChanged = dom.dataset.rows !== String(rows) || dom.dataset.cols !== String(cols);

  st.reconciling = true;
  try {
    if (shapeChanged) rebuildGrid(dom, rows, cols);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cellAt(dom, r, c);
        if (!cell) continue;
        const next = cells[r]?.[c] ?? "";

        if (cell === focused) {
          if (st.composing) continue;
          // Echo test, stateless: the document already says what this cell
          // says, so there is nothing to write.
          if (next === escapeCell(cell.textContent ?? "")) {
            cell.dataset.src = next;
            continue;
          }
          // The change came from elsewhere — undo, a remote peer, a structural
          // command. Sync, or the DOM drifts from the document permanently.
          const offset = caretOffsetIn(cell);
          cell.textContent = unescapeCell(next);
          setCaretOffset(cell, Math.min(offset, (cell.textContent ?? "").length));
        } else if (cell.dataset.src !== next || cell.dataset.raw === "1") {
          cell.dataset.src = next;
          toRendered(cell);
        }
        cell.dataset.src = next;
        applyAlign(cell, aligns[c] ?? "none");
      }
    }
  } finally {
    st.reconciling = false;
  }
}

/** Write a cell's text back as a minimal change over its own span. */
function commit(view: EditorView, dom: HTMLElement, cell: HTMLElement): void {
  const st = domState(dom);
  if (st.reconciling || st.composing) return;
  const row = Number(cell.dataset.tableRow);
  const col = Number(cell.dataset.tableCol);
  const tableFrom = view.posAtDOM(dom);
  const table = findTable(view.state, tableFrom);
  if (!table) return;
  const span = tableCellSpans(view.state, table)[row]?.[col];
  if (!span) return;

  const raw = escapeCell(cell.textContent ?? "");
  if (raw === view.state.sliceDoc(span.from, span.to)) return;

  // Undo is per cell: moving to another cell and typing starts a new history
  // group, so filling three cells quickly takes three ⌘Z to take back — not
  // one (time-based grouping alone would merge them).
  const key = `${row}:${col}`;
  const newCell = st.lastCell !== null && st.lastCell !== key;
  st.lastCell = key;
  view.dispatch({
    changes: { from: span.from, to: span.to, insert: raw },
    userEvent: "input.type",
    annotations: newCell ? isolateHistory.of("before") : undefined,
    scrollIntoView: false,
  });
}

/** Text pasted as a grid (tab-separated, or an HTML table) is written into the
 *  table starting at the focused cell, growing rows and columns as needed —
 *  one transaction, one undo step. A single value goes into the cell. */
function pasteInto(view: EditorView, dom: HTMLElement, cell: HTMLElement, data: DataTransfer): boolean {
  const grid = gridFromClipboard(data);
  if (!grid) return false;
  const row = Number(cell.dataset.tableRow);
  const col = Number(cell.dataset.tableCol);
  const tableFrom = view.posAtDOM(dom);
  const table = findTable(view.state, tableFrom);
  if (!table) return false;
  const rows = table.rows.map((r) => [...r]);
  const aligns = [...table.aligns];
  let cols = rows[0]?.length ?? 0;
  for (let r = 0; r < grid.length; r++) {
    while (rows.length <= row + r) rows.push(Array.from({ length: cols }, () => "   "));
    for (let c = 0; c < grid[r].length; c++) {
      while (cols <= col + c) {
        cols++;
        for (const existing of rows) existing.push("   ");
        aligns.push("none");
      }
      rows[row + r][col + c] = grid[r][c];
    }
  }
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: render(rows, aligns) },
    selection: EditorSelection.cursor(table.from),
    userEvent: "input.paste",
    annotations: isolateHistory.of("full"),
    effects: [focusTableCell.of({ row, col })],
    scrollIntoView: false,
  });
  return true;
}

/** A 2-D grid from the clipboard, or null when it is a single value. */
function gridFromClipboard(data: DataTransfer): string[][] | null {
  const html = data.getData("text/html");
  if (html && html.includes("<table")) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = Array.from(doc.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td,th")).map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    if (rows.length > 1 || (rows[0]?.length ?? 0) > 1) return rows;
  }
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!text.includes("\t") && !text.includes("\n")) return null;
  const rows = text.split("\n").map((line) => line.split("\t").map((v) => v.trim()));
  return rows.length > 1 || (rows[0]?.length ?? 0) > 1 ? rows : null;
}

/** Insert plain text at the caret of a contenteditable cell. */
function insertTextAtCaret(cell: HTMLElement, text: string): void {
  const sel = cell.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !cell.contains(sel.anchorNode)) {
    cell.textContent = (cell.textContent ?? "") + text;
    setCaretOffset(cell, (cell.textContent ?? "").length);
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = cell.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  cell.normalize();
}

/** Is the caret at the start / end of the cell's text? */
function caretAtEdge(cell: HTMLElement): { start: boolean; end: boolean } {
  const offset = caretOffsetIn(cell);
  const length = (cell.textContent ?? "").length;
  return { start: offset === 0, end: offset >= length };
}

/** Run a structural command against THIS table, whatever the caret is doing. */
function runControl(view: EditorView, dom: HTMLElement, action: string): void {
  const pos = view.posAtDOM(dom);
  const cmd =
    action === "add-row"
      ? tableInsertRowBelow
      : action === "add-column"
        ? tableInsertColumnRight
        : action === "delete-row"
          ? tableDeleteRow
          : action === "move-row-up"
            ? tableMoveRowUp
            : action === "move-row-down"
              ? tableMoveRowDown
              : tableDeleteColumn;

  // The commands read the caret to know which row/column to act on, so point
  // them at the focused cell — not at wherever the document selection sits.
  const focused = (view.root.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(
    "[data-table-cell]",
  );
  let anchor = pos;
  if (focused) {
    const table = findTable(view.state, pos);
    const spans = table ? tableCellSpans(view.state, table) : null;
    const span = spans?.[Number(focused.dataset.tableRow)]?.[Number(focused.dataset.tableCol)];
    if (span) anchor = span.from;
  }

  withTableAnchor(anchor, () => cmd({ state: view.state, dispatch: (tr) => view.dispatch(tr) }));
}

/** Attach the delegated listeners once, at toDOM time. */
function wire(dom: HTMLElement, view: EditorView): void {
  const st = domState(dom);

  dom.addEventListener("mousedown", (event) => {
    if (st.reconciling) return;
    const target = event.target as HTMLElement;
    const control = target.closest<HTMLElement>("[data-table-control]");
    if (control) {
      // Keep focus in the cell so the command knows which row/column to act on.
      event.preventDefault();
      runControl(view, dom, control.dataset.tableControl ?? "");
      return;
    }

    const cell = target.closest<HTMLElement>("[data-table-cell]");
    if (!cell || cell.dataset.raw === "1") return;
    // Swap rendered → raw NOW, without preventDefault. The default action runs
    // after listeners and hit-tests the DOM as it then stands, so the browser
    // seats the caret in the raw text — no offset map from rendered to source
    // is ever needed, and `**bold**` cells no longer drop the caret to 0.
    const previous = dom.querySelector<HTMLElement>('[data-table-cell][data-raw="1"]');
    if (previous && previous !== cell) toRendered(previous);
    toRaw(cell);
  });

  dom.addEventListener("focusin", (event) => {
    if (st.reconciling) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-table-cell]");
    if (!cell) return;
    toRaw(cell); // Tab-focus never went through mousedown.
    announceCell(view, dom, cell);
    // Park the document caret at the table's start, once. Every cell keystroke
    // makes the DOM observer compute a selection at exactly this position, so
    // leaving it here means CodeMirror does no extra work per keystroke.
    const pos = view.posAtDOM(dom);
    queueMicrotask(() => {
      if (view.state.selection.main.head !== pos) {
        view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select" });
      }
    });
  });

  dom.addEventListener("input", (event) => {
    if (st.reconciling) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-table-cell]");
    if (cell) commit(view, dom, cell);
  });

  dom.addEventListener("focusout", (event) => {
    if (st.reconciling) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-table-cell]");
    // Only re-render if focus actually left this cell for good; a control click
    // preventDefaults and keeps focus, so this does not fire for those.
    if (cell) queueMicrotask(() => {
      if (cell.ownerDocument.activeElement !== cell) toRendered(cell);
      const still = cell.ownerDocument.activeElement?.closest?.("[data-table-cell]");
      if (!still || !dom.contains(still)) announceCell(view, dom, null);
    });
  });

  dom.addEventListener("compositionstart", () => {
    st.composing = true;
  });
  dom.addEventListener("compositionend", (event) => {
    st.composing = false;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-table-cell]");
    if (cell) commit(view, dom, cell);
  });

  dom.addEventListener("paste", (event) => {
    if (st.reconciling) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-table-cell]");
    if (!cell || !event.clipboardData) return;
    // Always ours: the browser would otherwise paste markup into the cell.
    event.preventDefault();
    if (pasteInto(view, dom, cell, event.clipboardData)) return;
    const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
    if (!text) return;
    insertTextAtCaret(cell, text);
    commit(view, dom, cell);
  });

  dom.addEventListener("keydown", (event) => {
    if (st.reconciling) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-table-cell]");
    if (!cell) return;
    const row = Number(cell.dataset.tableRow);
    const col = Number(cell.dataset.tableCol);
    const cols = Number(dom.dataset.cols);
    const rows = Number(dom.dataset.rows);
    const go = (r: number, c: number, caret: "start" | "end") => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
      const target = cellAt(dom, r, c);
      if (!target) return false;
      target.focus();
      toRaw(target);
      setCaretOffset(target, caret === "end" ? (target.textContent ?? "").length : 0);
      return true;
    };
    // Newlines would break the row; a table cell is one line by definition.
    if (event.key === "Enter") {
      event.preventDefault();
      return;
    }
    // ⌘Z / ⌘⇧Z / Ctrl+Y: CodeMirror's history, not the browser's own undo of
    // the contenteditable (ignoreEvent keeps CM's keymap out of cells, so the
    // chord has to be forwarded by hand). reconcile() then rewrites the cell.
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && (event.key === "z" || event.key === "Z" || event.key === "y")) {
      event.preventDefault();
      const isRedo = event.key === "y" || event.shiftKey;
      if (isRedo) redo(view);
      else undo(view);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      let [r, c] = event.shiftKey ? [row, col - 1] : [row, col + 1];
      if (c >= cols) [r, c] = [row + 1, 0];
      if (c < 0) [r, c] = [row - 1, cols - 1];
      go(r, c, "end"); // append-friendly: Tab, type, Tab, type
      return;
    }
    // Alt+↑/↓ moves the row; plain arrows walk between cells at the edges of
    // the text (inside the text they move the caret as usual).
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && event.altKey) {
      event.preventDefault();
      runControl(view, dom, event.key === "ArrowUp" ? "move-row-up" : "move-row-down");
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const edge = caretAtEdge(cell);
    if (event.key === "ArrowLeft" && edge.start) {
      const [r, c] = col > 0 ? [row, col - 1] : [row - 1, cols - 1];
      if (go(r, c, "end")) event.preventDefault();
    } else if (event.key === "ArrowRight" && edge.end) {
      const [r, c] = col + 1 < cols ? [row, col + 1] : [row + 1, 0];
      if (go(r, c, "start")) event.preventDefault();
    } else if (event.key === "ArrowUp") {
      if (go(row - 1, col, "end")) event.preventDefault();
    } else if (event.key === "ArrowDown") {
      if (go(row + 1, col, "start")) event.preventDefault();
    }
  });

  watchPresence(dom, view);
}

/** Collab: what a table needs from the session — an awareness to read and
 *  write, and relative positions that survive concurrent edits. */
interface TableAwareness {
  clientID: number;
  getStates: () => Map<number, unknown>;
  getLocalState: () => Record<string, unknown> | null;
  setLocalStateField: (field: string, value: unknown) => void;
  on: (event: "change", f: () => void) => void;
  off: (event: "change", f: () => void) => void;
}
interface TableSyncConf {
  awareness?: TableAwareness;
  toYPos: (pos: number, assoc?: number) => unknown;
  fromYPos: (rpos: unknown) => { pos: number };
}

function syncConf(view: EditorView): TableSyncConf | null {
  return (view.state.facet(ySyncFacet) as TableSyncConf | undefined) ?? null;
}

/** Tell peers which cell this client is in. The document caret is parked at
 *  the table's start while a cell is edited (so remote-caret decorations can
 *  never name the cell), hence an explicit awareness field: the table by a
 *  relative position (stable across concurrent edits) plus row and column. */
function announceCell(view: EditorView, dom: HTMLElement, cell: HTMLElement | null): void {
  const conf = syncConf(view);
  const awareness = conf?.awareness;
  if (!conf || !awareness) return;
  if (!cell) {
    if (awareness.getLocalState()?.tableCell) awareness.setLocalStateField("tableCell", null);
    return;
  }
  let tableFrom: number;
  try {
    tableFrom = view.posAtDOM(dom);
  } catch {
    return;
  }
  awareness.setLocalStateField("tableCell", {
    table: conf.toYPos(tableFrom),
    row: Number(cell.dataset.tableRow),
    col: Number(cell.dataset.tableCol),
  });
}

/** Collab: tint the cells peers are in with their colour — the remote caret
 *  decorations cannot reach inside a replaced block, so this is how a table
 *  shows who is where. */
function watchPresence(dom: HTMLElement, view: EditorView): void {
  const conf = syncConf(view);
  const awareness = conf?.awareness;
  if (!conf || !awareness) return;
  const st = domState(dom);
  const paint = () => {
    // toDOM runs before the node is in the view; a detached node has no
    // position, and posAtDOM on it throws.
    if (!dom.isConnected || !view.contentDOM.contains(dom)) return;
    for (const el of dom.querySelectorAll<HTMLElement>("[data-table-cell][data-peer]")) {
      el.style.boxShadow = "";
      delete el.dataset.peer;
    }
    let tableFrom: number;
    try {
      tableFrom = view.posAtDOM(dom);
    } catch {
      return;
    }
    for (const [clientId, raw] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const state = raw as {
        tableCell?: { table: unknown; row: number; col: number } | null;
        user?: { name?: string; color?: string };
      } | null;
      const where = state?.tableCell;
      if (!where) continue;
      let pos: number | null = null;
      try {
        pos = conf.fromYPos(where.table).pos;
      } catch {
        pos = null;
      }
      if (pos !== tableFrom) continue;
      const cell = cellAt(dom, where.row, where.col);
      if (!cell) continue;
      const colour = state?.user?.color ?? presenceColor(state?.user?.name ?? String(clientId));
      cell.style.boxShadow = `inset 0 0 0 2px ${colour}`;
      cell.dataset.peer = state?.user?.name ?? "";
    }
  };
  awareness.on("change", paint);
  st.awarenessOff = () => awareness.off("change", paint);
  queueMicrotask(paint);
}

/** After a structural command, put focus where the person expects it. */
export const tableFocusPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(focusTableCell)) continue;
          const { row, col } = effect.value;
          const pos = update.state.selection.main.head;
          queueMicrotask(() => {
            for (const dom of update.view.contentDOM.querySelectorAll<HTMLElement>("[data-nodum-table]")) {
              if (update.view.posAtDOM(dom) !== pos) continue;
              const cell = cellAt(dom, row, col);
              if (cell) {
                cell.focus();
                toRaw(cell);
                setCaretOffset(cell, (cell.textContent ?? "").length);
              }
              break;
            }
          });
        }
      }
    }
  },
);

export class EditableTableWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly source: string,
  ) {
    super();
  }

  /** Identity and content only — never document position. A table that merely
   *  shifted because of an edit above it must reuse its DOM. */
  override eq(other: EditableTableWidget): boolean {
    return other.id === this.id && other.source === this.source;
  }

  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // findWidget offers us the DOM of ANY same-constructor widget still cached,
    // including a different table's. Without this guard two tables swap bodies.
    if (dom.dataset.tableId !== String(this.id)) return false;
    reconcile(dom, view, this.source);
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const dom = scaffold(this.id);
    reconcile(dom, view, this.source);
    wire(dom, view);
    return dom;
  }

  override destroy(dom: HTMLElement): void {
    DOM_STATE.get(dom)?.awarenessOff?.();
    DOM_STATE.delete(dom);
  }

  /** True = CodeMirror ignores the event. Wanted inside cells and controls, so
   *  the editor's own keymap and input handling stay out; NOT wanted on the
   *  surrounding padding, where a drag should still extend the doc selection. */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target?.closest) return false;
    return Boolean(target.closest("[data-table-cell], [data-table-control]"));
  }

  override get estimatedHeight(): number {
    return this.source.split("\n").length * 34 + 12;
  }
}
