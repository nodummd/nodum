# SPEC — Editable tables in live preview

Synthesised from three independently designed and judged architectures, all
verified against the pinned CodeMirror sources (`@codemirror/view@6.43.8`,
`@codemirror/state@6.7.1`, `@codemirror/commands@6.10.4`). Companion to
`tasks/nodum-editor-fixes-goal.md` item P1-8.

**Progress:** Step 1 (one parser) landed in `0a28315`. Steps 2-9 outstanding.

---

I read every cited file plus the pinned CodeMirror sources and verified the load-bearing internals myself. Everything below is checked against `@codemirror/view@6.43.8`, `@codemirror/state@6.7.1`, `@codemirror/commands@6.10.4`, `@lezer/markdown@1.7.2`.

---

# Editable tables in Live Preview — implementation specification

## 1. Chosen architecture, and why the other two lost

**Chosen: the in-widget editable table** — Design 1, "EditableTableWidget (contenteditable cells, minimal-span writeback)". The rendered `<table>` stays a `Decoration.replace({block:true})`, but its `<th>/<td>` become `contenteditable` islands nested inside CodeMirror's own contenteditable. Each keystroke becomes a minimal `{from,to,insert}` over exactly that cell's content span. Row/column/align/sort controls run the existing `StateCommand`s in `table-commands.ts` unchanged, by parking the CM caret at the target cell first.

It wins because it is the only one of the three that actually delivers the maintainer's sentence — *"see the real table structure and edit inside"* — and because the CodeMirror internals genuinely cooperate. I confirmed all four load-bearing facts in the installed tree:

- `DOMObserver.readMutation` returns `null` for any mutation whose nearest tile is a widget (`node_modules/@codemirror/view/dist/index.js:7468-7470`: `let tile = this.view.docView.tile.nearest(rec.target); if (!tile || tile.isWidget()) return null;`). CM never sees our cell mutations.
- `TileCache.findWidget` (`:2554-2580`) is two-pass: pass 0 `tile.widget.compare(widget)`, pass 1 `tile.widget.constructor == widget.constructor && widget.updateDOM(tile.dom, this.view, tile.widget)`. On pass-1 success it constructs `new WidgetTile(tile.dom, …)` — **the same DOM node**. Focus and the native caret survive by construction. The 3-arg `updateDOM(dom, view, from)` signature is real (`:135`).
- `eventBelongsToEditor` (`:4867-4877`) walks target→contentDOM and bails on the first widget tile whose `ignoreEvent` returns true. It is the sole gate in `InputState.handleEvent` (`:4557`), so `ignoreEvent → true` isolates the cell from `defaultKeymap`, `closeBrackets`, `autocompletion`, CM's mouse selection, and CM's own `beforeinput`/`paste`.
- `atomicRanges` has exactly four consumers — `skipAtoms` (`:3785`), `applyDOMChange` for `select.pointer` only (`:4313`), `applyDefaultInsert` (`:4358`), `MouseSelection` (`:4748`). **There is no transaction filter.** A programmatic `view.dispatch({selection: EditorSelection.cursor(insideTable)})` is delivered verbatim, which is what makes command reuse possible.

And one the design asserted without citing, which I verified and which matters more than any of the above: `DocView.updateSelection` (`:3032-3040`) early-returns unless `focused || fromPointer || selectionNotFocus`, where `focused = (root.activeElement == contentDOM)` and `selectionNotFocus` is false while `editable` is true. **While a cell holds focus, CodeMirror never writes the DOM selection.** The caret in the cell cannot be stolen.

**Design 2 (live-row character grid) lost on the goal itself.** Its own summary concedes the row you edit *is* raw markdown — visible pipes, raw inline syntax across the whole row, and the entire table forced to monospace. That is a better reveal rule, not editing inside a table. It also carries a fallback matrix (wide tables, CJK/emoji width, >200 rows, any font whose `1ch` measurement disagrees) that routes exactly the tables most in need of better editing back to today's behaviour, and it runs two parsers that disagree: the split is driven from the lezer `Table` node while every command goes through `findTable`, whose `isRow = /^\s*\|.*\|\s*$/` (`table-commands.ts:27`) rejects the pipe-less GFM rows lezer accepts.

**Design 3 (React grid pinned over an inert widget) lost on geometry and on two specified mechanisms that are wrong.** The pin is a measured `getBoundingClientRect`, not layout, so every async layout change that does not route through CodeMirror desynchronises it — and `live-preview.ts` sets `img.src` from an async promise with no dimensions, so image embeds above a table are a built-in trigger. Worse, its stored cell-span mapping is inverted (`from: mapPos(c.from, 1), to: mapPos(c.to, -1)`). I traced this through `ChangeDesc.mapPos` (`@codemirror/state/dist/index.js:736-758`): for a zero-width cell range at X and an insert of N, `mapPos(X, 1)` returns `X+N` and `mapPos(X, -1)` takes the `endA == pos && assoc < 0 && !len` guard and returns `X`. The stored range inverts, and the next commit throws in `ChangeSet.of`. Zero-width cell ranges are exactly what `insertTable` (`format-commands.ts:298-317`) produces for every body cell (`"   "`), so it breaks on the headline flow. Its structural-reparse trigger (`userEvent === "input.format" || "input.paste"`) also misses undo and every remote Yjs transaction, contradicting its own collab section.

**What we graft from the losers** (details in place below):

| From | Graft |
|---|---|
| D2 | `eq()` must never compare absolute document offsets — that is `PropertiesWidget`'s bug at `block-widgets.ts:138-140`; resolve cell interiors from **pipe positions**, never from `TableCell` nodes (an all-whitespace cell emits no `TableCell` — `@lezer/markdown/dist/index.cjs:2055-2062`, and `emptyRow` inserts `"   "`); the `caret?:` hook on `tableCommand`; per-line minimal diff instead of whole-range replace; the widget-level `contextmenu` handler that fixes `posAtCoords(…, false)` snapping to the block boundary; `opacity:0` not `display:none` so Playwright treats controls as clickable. |
| D3 | The `isolateHistory` grouping scheme; awaitable test attributes over `waitForTimeout`; the "all three parsers must move together" requirement; the flush/commit choke-point discipline. |
| Judges | Deferred focus + a reconcile re-entrancy guard (kills the crash-on-first-Add-row); the mousedown-before-default trick that solves the rendered→raw caret mapping without an offset map; `insertTable` must open a cell. |

Two simplifications I am making over Design 1 as written, both of which remove state rather than add it:

1. **No `state.pushed` string.** The echo test becomes stateless: skip the focused cell iff `next === escapeCell(cell.textContent)`. That is literally "the document already says what this cell's DOM says", and it handles the local echo, a remote no-op, and any interleaving without tracking anything.
2. **The CM caret parks at the table's block start, not at the focused cell, and cell-edit transactions carry no `selection` key.** See §4 for why this is worth a whole extra paragraph — it turns "two CM update cycles per keystroke" into zero.

---

## 2. File-by-file changes

### NEW `web/src/lib/editor/table-model.ts` — pure, no DOM, no `EditorView`

This is the single parser. **`table-commands.ts`'s private `splitRow` (`:31-34`), `TableWidget.toDOM`'s private `parseRow` (`block-widgets.ts:55-60`), and the new span code must all call `splitCells`.** Today the first two split naively on every `|`; the moment a user can type a pipe into a cell, they disagree with each other and with the widget's `data-table-col` indices, and clicking cell 3 opens cell 2. This is a prerequisite, not a nicety.

```ts
export type Align = "left" | "center" | "right" | "none";

/** One cell of one row: text plus offsets RELATIVE TO THE LINE START. */
export interface RawCell { text: string; from: number; to: number }

/** Split a table line on UNESCAPED pipes. `from`/`to` bound the trimmed
 *  content; an all-whitespace cell yields a zero-width span one space in
 *  from its opening pipe, so an insert lands with padding on both sides. */
export function splitCells(line: string): RawCell[];

/** Text-only convenience over splitCells — the replacement for the private
 *  splitRow in table-commands.ts. Unescapes `\|` → `|`. */
export function splitRow(line: string): string[];

export function escapeCell(s: string): string;   // \ → \\ , | → \| , \r?\n → <br>
export function unescapeCell(s: string): string; // <br> → \n , \| → | , \\ → \
export function cellWidth(s: string): number;    // escaped length — render() pads on this

export function isRow(text: string): boolean;      // moved from table-commands.ts:27
export function isDivider(text: string): boolean;  // moved from table-commands.ts:28
export function alignOf(spec: string): Align;

/** Clipboard → grid. Returns null when the text is a single plain value. */
export function parseGrid(text: string): string[][] | null;
```

`splitCells` scans left to right tracking a backslash-escape flag, exactly as lezer's `parseRow` does (`index.cjs:2061-2075`: `if (next == 124 && !esc)` … `esc = !esc && next == 92`). That guarantees our column indices agree with the syntax tree.

`escapeCell`/`unescapeCell` must round-trip: `escapeCell(unescapeCell(s)) === s` for every `s` `splitCells` can produce. Assert this in the unit tests.

### EDIT `web/src/lib/editor/table-commands.ts`

All changes additive or signature-compatible.

```ts
export interface Table { from: number; to: number; rows: string[][]; aligns: Align[]; row: number; col: number }
export interface CellSpan { from: number; to: number; row: number; col: number }

/** Was: findTable(state) reading state.selection.main.head (`:53`).
 *  Now takes an explicit position, defaulting to the caret — every existing
 *  call site is unchanged. */
export function findTable(state: EditorState, pos?: number): Table | null;

/** Absolute document spans of every cell's trimmed content, divider excluded.
 *  Built from splitCells + line.from. Indices match `table.rows`. */
export function tableCellSpans(state: EditorState, table: Table): CellSpan[][];

/** Now exported — the paste path serialises through it. Widths use cellWidth. */
export function render(rows: string[][], aligns: Align[]): string;

/** New: minimal per-line diff over [from,to]. Trims common leading and
 *  trailing identical lines and emits ONE change for the middle. */
export function tableChanges(state: EditorState, table: Table, next: string): ChangeSpec;

export const tableMoveRowUp: StateCommand;
export const tableMoveRowDown: StateCommand;
export function tablePasteGrid(grid: string[][]): StateCommand;
```

`tableCommand` gains a caret hook and switches to the minimal diff:

```ts
function tableCommand(
  edit: (t: Table) => { rows: string[][]; aligns: Align[] } | null,
  caret?: (t: Table) => { row: number; col: number },
): StateCommand {
  return ({ state, dispatch }) => {
    const table = findTable(state);
    if (!table) return false;
    const next = edit(table);
    if (!next) return false;
    const text = render(next.rows, next.aligns);
    dispatch(state.update({
      changes: tableChanges(state, table, text),           // was: whole-range replace at :121-122
      selection: EditorSelection.cursor(table.from),        // unchanged
      userEvent: "input.format",
      annotations: [isolateHistory.of("full")],
      effects: caret ? [focusTableCell.of(caret(table))] : [],
    }));
    return true;
  };
}
```

Caret hooks, which are what make the feature feel finished (today every op leaves the caret at `table.from`, `:123`):

| command | `caret` |
|---|---|
| `tableInsertRowAbove` | `t => ({ row: Math.max(1, t.row), col: t.col })` |
| `tableInsertRowBelow` | `t => ({ row: t.row + 1, col: t.col })` |
| `tableDeleteRow` | `t => ({ row: Math.min(t.row, t.rows.length - 2), col: t.col })` |
| `tableInsertColumnLeft` / `Right` | `t => ({ row: t.row, col: t.col + 1 })` |
| `tableDeleteColumn` | `t => ({ row: t.row, col: Math.min(t.col, (t.rows[0]?.length ?? 1) - 2) })` |
| align / sort / format / move row | `t => ({ row: t.row, col: t.col })` (move row: `t.row ± 1`) |

`focusTableCell` is imported from `table-widget.ts`; `table-commands.ts` may import the effect definition without importing any DOM code (put the effect in `table-model.ts` if you want the dependency to point strictly downward — either is fine, just do not create a cycle).

### NEW `web/src/lib/editor/table-widget.ts`

Owns `EditableTableWidget`, the per-table identity map, the DOM state `WeakMap`, the wiring, and the deferred-focus `ViewPlugin`.

```ts
export const focusTableCell = StateEffect.define<{ row: number; col: number; tableId?: number }>();
export const rawTableSource  = StateEffect.define<number | null>();  // Edit-source escape hatch

export interface TableIdentity { deco: DecorationSet; tables: { from: number; to: number; id: number }[]; nextId: number; rawId: number | null }

export class EditableTableWidget extends WidgetType { … }   // contract in §3

/** Consumes focusTableCell / applies pendingFocus AFTER the update cycle. */
export const tableFocusPlugin: Extension;

/** Module-internal, exported for tests. */
export function tableSourceOf(state: EditorState, from: number, to: number): string;
```

Per-DOM mutable state lives in a module `WeakMap<HTMLElement, TableDomState>`. Never on the widget instance — widget instances are recreated on every rebuild; the DOM is what persists.

```ts
interface TableDomState {
  reconciling: boolean;              // re-entrancy guard — see §3
  composing: boolean;                // IME
  pendingFocus: { row: number; col: number } | null;
  lastCell: string | null;           // "r:c" — drives isolateHistory
  parked: boolean;                   // CM caret already parked at this table's start
}
```

### EDIT `web/src/lib/editor/block-widgets.ts`

- `TableWidget` (`:41-83`) is deleted; the `Table` branch (`:376-386`) delegates to `EditableTableWidget` and **drops its `selectionTouches` gate** (see §5). Keep `renderCellHTML` (`:29-39`) and export it — the widget renders unfocused cells through it, which is what keeps `notes.spec.ts:199` (`.cm-table-widget td strong`) passing.
- `TableWidget.toDOM`'s private `parseRow` (`:55-60`) dies with it; the widget uses `splitCells`.
- `blockWidgetField`'s value type changes from `DecorationSet` to `TableIdentity`; `provide` reads `.deco` (`:431-434` become `EditorView.decorations.from(field, v => v.deco)` and `EditorView.atomicRanges.of(view => view.state.field(field).deco)`).
- `update()` maps every previous `{from,to,id}` through `tr.changes` (`mapPos(from, -1)` / `mapPos(to, 1)` — note the associations; a table only ever grows outward at its own edges) before rebuilding. A new `Table` node at `[from,to]` reuses the id of the first mapped entry that overlaps it, else mints `nextId++`. Ids are per-`EditorState`, so a key-driven remount restarts them naturally.
- The IME guard at `:427` stays, and now also skips the rebuild when any live table's `domState.composing` is set — a remote transaction arriving mid-composition carries no `input.type.compose` annotation.
- Frontmatter, block math and fenced code keep their existing `selectionTouches` reveal untouched. This is a table-local rule change, not a policy change.
- `blockWidgets()` returns `[blockWidgetField, tableFocusPlugin]`, and takes an `{ editableTables: boolean }` option; when false it emits the old read-only widget path (keep a small `ReadOnlyTableWidget` for the flag-off branch and for A/B).

### EDIT `web/src/lib/editor/format-commands.ts`

`insertTable` (`:298`) appends `effects: [focusTableCell.of({ row: 1, col: 0 })]` to its transaction. This is the maintainer's literal flagship flow: *"once you insert the table…"*. Without it, deleting the reveal gate gives you a rendered widget with the caret in an atomic range and no cell focused, and the user has to hunt-and-click.

### EDIT `web/src/components/editor/markdown-editor.tsx`

- New prop `editableTables?: boolean` (default true), threaded into `blockWidgets({ editableTables })` at `:120`, and added to the `useEffect` dep array at `:144`.
- `syncCaretToPointer` (`:155-163`) gains one guard as its first statement:
  ```ts
  if ((event.target as HTMLElement).closest?.("[data-table-cell], [data-table-control]")) return;
  ```
  Without it, `posAtCoords(…, false)` snaps to the widget's start and the context menu acts on row 0 / column 0 instead of the cell the user pointed at. The widget's own `contextmenu` listener has already parked the caret correctly by the time this runs.

### EDIT `web/src/components/editor/editor-context-menu.tsx`

`run()` (`:192-198`) calls `view.focus()` unconditionally, which yanks focus out of a cell after every table command:

```ts
const run = (cmd: Cmd) => () => {
  const view = getView();
  if (!view) return;
  const wasEditingCell = Boolean(view.dom.querySelector("[data-cell-editing]"));
  cmd(view);
  if (!wasEditingCell) view.focus();   // else the focusTableCell effect restores it
};
```

Add two items to the existing Table group (`:346-370`), gated on `ctx.inTable` like the rest: **Move row up** / **Move row down**, and **Edit table source** (dispatches `rawTableSource`).

Document the rule this establishes, because it will be reintroduced otherwise: *any code path that restores focus to the editor must first check whether a table cell holds it.* Command-palette close, tab switch and modal dismiss are the next candidates.

### EDIT `web/src/lib/hooks/use-editor-settings.ts`, `web/src/components/workspace/editor-pane.tsx`

Add `editableTables: boolean` (default `true`) to `EditorSettings` and `parseEditorSettings`. `users.settings` is free-form JSONB and the parser already supplies defaults for missing keys, so **no migration and no backend change**. Pass `editorSettings.editableTables` down at `editor-pane.tsx:391` next to `showLineNumbers`.

### EDIT `web/src/app/globals.css`

Extend the `.cm-table-widget` block (`:340-347`). Note the existing `font-size: 0.95em` on the table and `padding: 4px 10px` on cells stay — nothing here depends on character-grid alignment, unlike Design 2. Add: cell `outline` on `[data-cell-editing]`, `white-space: pre-wrap` on cells so `<br>`-derived newlines render, rail/toolbar chrome at `opacity: 0` with `:hover, :focus-within` → `1` (never `display:none`), and `@media (pointer: coarse)` pinning controls visible at 44px.

### NEW `web/e2e/table-edit.spec.ts`; EDIT `web/e2e/helpers.ts`

`sourceText` and `setup` are currently **local** to `editor-context-menu.spec.ts:46-58`, not exports of `helpers.ts` (which exports `uniqueEmail`, `PASSWORD`, `signupFreshUser`, `openNoteFromExplorer`, `createNoteViaApi`, `editorSurface`). Extract `sourceText` into `helpers.ts` and re-import it in the context-menu spec.

### Unit tests

`web/package.json` has only `dev`/`build`/`start`/`lint` — no unit runner. Add vitest scoped to `web/src/lib/editor/`. `table-model.ts` and `tableCellSpans` are pure over an `EditorState.create({doc, extensions:[markdown()]})` and this is exactly the offset math that is miserable to debug through a browser. Add `"test": "vitest run"` and wire it into `make web-lint`'s neighbours.

---

## 3. The exact `updateDOM` / `eq` / `ignoreEvent` contract

```ts
export class EditableTableWidget extends WidgetType {
  constructor(readonly id: number, readonly source: string) { super(); }

  // Identity + content ONLY. Document position is deliberately absent: a table
  // that merely shifted must reuse its DOM. (PropertiesWidget compares from/to
  // at block-widgets.ts:138-140 and therefore rebuilds on every edit above it.)
  // The widget resolves its live offset with view.posAtDOM(dom) at event time —
  // verified: posFromDOM returns tile.posAtStart for any node inside a widget
  // tile (@codemirror/view/dist/index.js:3203-3205).
  override eq(other: EditableTableWidget): boolean {
    return other.id === this.id && other.source === this.source;
  }

  override updateDOM(dom: HTMLElement, view: EditorView, old: this): boolean {
    // findWidget's pass 1 offers updateDOM the DOM of ANY same-constructor
    // widget still in the cache (:2568) — including a DIFFERENT table's.
    // Without this guard two tables swap bodies.
    if (old.id !== this.id || dom.dataset.tableId !== String(this.id)) return false;
    reconcile(dom, view, this.source);
    return true;                      // → Reused.DOM → new WidgetTile(tile.dom, …)
  }                                   //   the SAME node, so focus + caret survive

  override toDOM(view: EditorView): HTMLElement {
    const dom = scaffold(this.id);    // <div class="cm-table-widget" data-nodum-table data-table-id>
    reconcile(dom, view, this.source);
    wire(dom, view);                  // delegated listeners, attached exactly once
    return dom;
  }

  override destroy(dom: HTMLElement) { DOM_STATE.delete(dom); }

  override get estimatedHeight() { return this.source.split("\n").length * 34 + 12; }

  // ignoreEvent's DEFAULT IS TRUE (:161) and it means "the editor ignores this
  // event". eventBelongsToEditor (:4867-4877) walks target→contentDOM and drops
  // the event on the first widget tile that returns true — which suppresses
  // defaultKeymap, closeBrackets, autocompletion, CM's mouse selection, and CM's
  // own beforeinput/paste handlers. We want that for the editing surface and the
  // controls, and NOT for the widget's outer padding: a drag started outside the
  // table must still be able to extend the document selection across it.
  override ignoreEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null;
    if (!t?.closest) return false;
    return Boolean(t.closest("[data-table-cell], [data-table-control], [data-table-menu]"));
  }
}
```

### `reconcile(dom, view, source)` — the focus invariant

**The rule: the element the user is typing into is never written while the document already says what that element says.**

```ts
function reconcile(dom: HTMLElement, view: EditorView, source: string) {
  const st = domState(dom);
  const { cells, aligns } = parseTableSource(source);           // splitCells per line
  const active = view.root.activeElement as HTMLElement | null;
  const focused = active?.closest?.("[data-table-cell]") ?? null;
  const shapeChanged =
    dom.dataset.rows !== String(cells.length) ||
    dom.dataset.cols !== String(cells[0]?.length ?? 0);

  st.reconciling = true;                                        // ← re-entrancy guard
  try {
    if (shapeChanged) rebuildGrid(dom, cells.length, cells[0]?.length ?? 0);

    for (let r = 0; r < cells.length; r++) for (let c = 0; c < cells[r].length; c++) {
      const cell = cellAt(dom, r, c)!;
      const next = cells[r][c];                                 // ESCAPED source text

      if (cell === focused) {
        if (st.composing) continue;                             // never touch a composing cell
        // ECHO TEST — stateless. If the document agrees with the DOM there is
        // nothing to write, and writing would collapse the caret to offset 0
        // on every keystroke. This is the single most important line here.
        if (next === escapeCell(cell.textContent ?? "")) { cell.dataset.src = next; continue; }
        // Otherwise the change came from elsewhere: undo, redo, a remote Yjs
        // peer, a version restore, a structural command. We MUST sync or the
        // DOM drifts permanently out of the document.
        const off = caretOffsetIn(cell);
        cell.textContent = unescapeCell(next);
        setCaretOffset(cell, Math.min(mapCaret(st, off), (cell.textContent ?? "").length));
      } else if (cell.dataset.src !== next || cell.dataset.raw === "1") {
        cell.dataset.raw = "0";
        cell.innerHTML = renderCellHTML(unescapeCell(next));    // inline markdown
      }
      cell.dataset.src = next;
      applyAlign(cell, aligns[c] ?? "none");
    }
  } finally {
    st.reconciling = false;
  }

  if (shapeChanged && st.pendingFocus) {
    const t = st.pendingFocus; st.pendingFocus = null;
    scheduleFocus(view, dom, t.row, t.col);                     // NOT synchronous — see below
  }
}
```

### The re-entrancy guard, which is not optional

`EditorView.update` **throws** at `index.js:7948-7949` (`"Calls to EditorView.update are not allowed while an update is in progress"`) whenever `updateState != 0`. `updateDOM` → `reconcile` runs *inside* `view.update()`, so `updateState == 2`. The structural path calls `replaceChildren` on the tbody, which removes the focused cell and fires `focusout` synchronously; if the `focusout` handler dispatches, it throws. Then `.focus()` on the new target fires `focusin`; if that handler dispatches, it throws. **As written in the original design, clicking "Add row" once crashes the view.** Two guards close it, and both are required:

1. Every delegated handler begins `if (domState(dom).reconciling) return;`.
2. `scheduleFocus` never focuses synchronously:
   ```ts
   function scheduleFocus(view: EditorView, dom: HTMLElement, row: number, col: number) {
     queueMicrotask(() => {
       const cell = cellAt(dom, row, col); if (!cell) return;
       toRaw(cell); cell.focus(); setCaretOffset(cell, (cell.textContent ?? "").length);
     });
   }
   ```
   `view.update()` resets `updateState` to Idle in its own `finally` before returning, and a microtask queued during it runs after the whole synchronous dispatch completes. `tableFocusPlugin` consumes `focusTableCell` the same way — a `ViewPlugin.update` also runs inside the update cycle.

### The rendered→raw swap, and its caret

Unfocused cells render inline markdown through `renderCellHTML`; the focused cell shows raw text. Swapping `**bold** text` (13 raw chars) for its rendered form (9 chars) means a click offset cannot be copied across — `renderCellHTML` is a chain of regex replaces and produces no offset map. The original design left this unaddressed; clicking any cell containing bold/italic/code/strike would drop the caret to offset 0.

**Solution: swap during `mousedown`, before the browser's default action computes the caret.**

```ts
function onMouseDown(e: MouseEvent, dom: HTMLElement) {
  const st = domState(dom); if (st.reconciling) return;
  const target = e.target as HTMLElement;
  if (target.closest("[data-table-control]")) { e.preventDefault(); return; }  // keep cell focus
  const cell = target.closest<HTMLElement>("[data-table-cell]");
  if (!cell || cell.dataset.raw === "1") return;
  const prev = dom.querySelector<HTMLElement>('[data-table-cell][data-raw="1"]');
  if (prev && prev !== cell) toRendered(prev);
  toRaw(cell);                                   // textContent = unescapeCell(dataset.src)
  // NO preventDefault: the default action runs after listeners and hit-tests the
  // DOM as it now stands, so the browser seats the caret in the raw text it can
  // see. No offset map is ever needed.
}
```

`toRaw`/`toRendered` read `cell.dataset.src`, never the live `textContent`, so a mousedown can never commit. Keyboard-initiated focus (Tab, `focusTableCell`) targets an explicit boundary (start or end of cell), so it needs no mapping either. `document.caretRangeFromPoint` is the fallback only if a browser is ever found that hit-tests against stale layout; do not write it speculatively.

---

## 4. Source mapping for a cell edit

A keystroke is one `{from, to, insert}` over that cell's trimmed content span. Nothing else in the table moves.

**Spans.** For each non-divider table line (`isDivider`, matching `table-commands.ts:28`), `splitCells` returns unescaped-pipe-delimited cells with content-trimmed relative offsets; add `line.from`. Cell `k` of `| a | b |` at `line.from = L` has content span `[L+2, L+3)`. An all-whitespace cell `|   |` collapses to the zero-width point `L + pipeIndex + 2` — one space in from the pipe — so an insertion lands with padding on both sides and the row stays visually intact.

Spans are derived from **pipe positions, not `TableCell` nodes**. `@lezer/markdown/dist/index.cjs:2055-2062` shows `TableCell` spans only the trimmed content and an all-whitespace cell emits **no node at all** — and `emptyRow` (`table-commands.ts:131`) inserts `"   "`, so every freshly created row is entirely node-less. Any design that resolves cells through `TableCell` breaks on the row it just made.

**Commit — the `input` handler:**

```ts
function commit(view: EditorView, dom: HTMLElement, cell: HTMLElement) {
  const st = domState(dom);
  if (st.reconciling || st.composing) return;
  const row = +cell.dataset.tableRow!, col = +cell.dataset.tableCol!;
  const tableFrom = view.posAtDOM(dom);                       // LIVE offset, never cached
  const table = findTable(view.state, tableFrom);
  if (!table) return;
  const span = tableCellSpans(view.state, table)[row]?.[col];
  if (!span) return;
  const raw = escapeCell(cell.textContent ?? "");
  if (raw === view.state.sliceDoc(span.from, span.to)) return;

  const key = `${row}:${col}`;
  const isolate = st.lastCell !== null && st.lastCell !== key;
  st.lastCell = key;

  view.dispatch({
    changes: { from: span.from, to: span.to, insert: raw },
    userEvent: "input.type",
    annotations: isolate ? [isolateHistory.of("before")] : [],
    scrollIntoView: false,
    // NO `selection` key — see below.
  });
}
```

Offsets are resolved at event time via `view.posAtDOM(dom)`, matching the discipline the checkbox handler already documents (`live-preview.ts:445-451`, `const pos = view.posAtDOM(target)`). I verified `posFromDOM` returns `tile.posAtStart` for any node inside a widget tile (`index.js:3203-3205`), so this yields the table block's live start after arbitrary edits elsewhere.

### Why there is no `selection` key, and why the caret parks at the table's start

This is the difference between "two CodeMirror update cycles per keystroke" and zero, and it took reading the observer to see.

Every cell keystroke produces MutationRecords, so `DOMObserver.flush()` runs. `processRecords` drops all of them (`readMutation` → widget → `null`), so `from = -1`. But `flush()` calls `readSelectionRange()` first (`:7454`), which sets `selectionChanged = true` whenever the DOM selection is inside `contentDOM` (`:7280-7282`) — and our cell *is* inside contentDOM. So `readChange()` returns a `DOMChange` with `domChanged = false` and a `newSel` computed from `posFromDOM(cellTextNode)` — which is the table's `posAtStart`.

`applyDOMChange` then hits `else if (newSel && (!view.hasFocus && state.facet(editable) || sameSelPos(newSel, sel))) newSel = null;` (`:4266`). `view.hasFocus` requires `root.activeElement == contentDOM` (`:8609-8610`) and our cell holds focus, so it is false → `newSel = null` → `return false`. Good: no spurious selection dispatch.

But back in `flush()` (`:7458-7461`):
```js
if (this.view.state == startState && (domChange.domChanged || domChange.newSel && !sameSelPos(this.view.state.selection, domChange.newSel.main)))
    this.view.update([]);
```
If the CM selection is anywhere other than the table's `posAtStart`, `sameSelPos` is false and CM runs a full empty update cycle on **every keystroke**.

So: on `focusin`, park the CM caret once at `view.posAtDOM(dom)` (deferred via `queueMicrotask`, `userEvent: "select"`, only if it is not already there), and never move it again while typing. `posFromDOM` reports exactly that position for anything inside the widget, so `sameSelPos` is permanently true. A cell-edit transaction with no `selection` key maps the existing selection through the change; the caret sits at `table.from`, before every cell edit, so it never moves. Zero extra CM work per keystroke, by construction.

This also protects undo grouping: `HistoryState.addChanges` requires `!lastEvent.selectionsAfter.length` (`@codemirror/commands/dist/index.js:486`), so a selection-only transaction between two typing transactions would break the group. Parking once, on focus, is the only selection dispatch in the typing path.

### What is deliberately not done per keystroke

No re-padding. `render()` (`:97-108`) pads every column to its widest cell and is a whole-table replacement; running it on `input` would fight every other decoration, fill the undo stack with whole-table replacements, and move the caret. Columns go ragged in the *source* while typing — invisible in the rendered table — and are re-padded at explicit boundaries only: **Format table** and any structural command, both already single transactions. Flag this to the maintainer: someone reading the raw markdown in git or Source mode will see unpadded tables until Format table runs. It is the correct trade, but it is a visible behaviour change.

### Escaping is a hard prerequisite

`splitRow` (`:31-34`) does a plain `.split("|")` today. That is a latent destructive bug *right now* — a user can type `\|` in Source mode and every row/column command then mis-parses the row and `render()` rewrites it. Once a cell is directly typeable it becomes a one-keystroke corruption path. Land the `splitCells` fix in `table-commands.ts`, in the widget, and in `render()`'s width calculation **together**, in step 1 below, before anything else ships.

---

## 5. The reveal rule

The contradiction is real: `selectionTouches(state, node.from, node.to)` at `block-widgets.ts:377` means "click the table, lose the table" — and worse, our own caret-parking at `table.from` would trip it on every focus. It is resolved by moving reveal from **block** granularity to **cell** granularity for tables only.

1. **Delete the gate for tables.** The `Table` branch becomes unconditional except for rule 3. With editable cells the gate buys nothing (the widget *is* the editing surface) and costs everything.
2. **Reveal applies per cell.** The focused cell renders raw markdown text; every other cell renders through `renderCellHTML`. This is Obsidian's own rule ("raw syntax where the cursor is") restated at the granularity the user is editing, and it is also required for correctness: typing `**` into a cell whose DOM is rendered HTML would have the browser mutate live `<strong>` nodes under the caret.
3. **Explicit whole-table source escape hatch.** `rawTableSource: StateEffect<number|null>` holds one table id in `TableIdentity.rawId`; while set, that table emits no decoration and edits as ordinary markdown lines. Triggers: the widget toolbar's **Edit source** button, the new context-menu item, and `Escape` twice from a cell. Cleared by any transaction whose new selection no longer intersects the table's mapped range. Pane-level Source mode is unaffected — it never installs `blockWidgets()` at all (`markdown-editor.tsx:118-121`).
4. **Consequence, stated rather than papered over.** A selection that spans the table (Select All, a drag from above to below) no longer flips it to source. Copy and cut still yield the raw markdown, because `WidgetTile.overrideDOMText` returns `doc.slice(start, start + length)` — I verified this at `index.js:2141-2149`. What genuinely changes is that *typing over* such a selection replaces the table with the typed character, the same as any other selected block. Acceptable.
5. **Nothing else changes.** Frontmatter, block math and fenced code keep their existing reveal.

---

## 6. Controls UX and the test hooks

Obsidian's model: hover-revealed rails so the table reads clean when idle.

- **Row rail** — 14px gutter left of the table, one grip per `<tr>`. Menu: Insert row above / below, Move row up / down, Delete row. The header grip omits insert-above and delete, matching the existing guards (`:135`, `:148`).
- **Column rail** — 14px strip above, one grip per column. Menu: Insert column left / right, Align ▸ (Left / Centre / Right / Default), Sort ▸ (A→Z / Z→A), Delete column.
- **Two one-click adders** — a full-width `+` bar flush under the last row and a full-height `+` bar flush right of the last column. Single click, no menu. This is the maintainer's literal ask and it should be the fastest path in the UI.
- **Toolbar**, top-right on hover: Format table, Edit source.
- **Keyboard**, owned by the widget (CM's keymaps never see these — `ignoreEvent` returns true): `Tab`/`Shift-Tab` next/previous cell wrapping, `Tab` in the last cell appends a row; `Enter` moves down, creating a row at the bottom; `Shift-Enter` inserts a `<br>`; `ArrowLeft/Right` at text boundaries and `ArrowUp/Down` at first/last line move between cells; `Escape` blurs, focuses `view.contentDOM`, parks the caret just after the table; `Mod-z`/`Mod-Shift-z` call `undo`/`redo` from `@codemirror/commands` directly.
- **Right-click** still works: the container-level handler (`markdown-editor.tsx:155-163`) exists precisely because widget events never reach CM handlers. The widget's own `contextmenu` listener runs first and parks the caret at the pointed cell, so the existing Table group becomes correct-by-construction instead of acting on row 0 / column 0.
- All controls are `<button type="button">` with `preventDefault()` on **mousedown** so the focused cell does not blur before the command runs. Menus are plain `<div role="menu">` inside the widget — do not mount Radix here; React must not reconcile nodes CodeMirror owns.
- Chrome is `opacity: 0` → `1` on `:hover, :focus-within`, **never `display: none`**: Playwright treats an opacity-0 element with a non-empty box as visible and clickable, so tests need no `force`.

### Command dispatch — how the widget knows its row and column

The widget contains **zero** source-manipulation code for structural operations. `findTable` derives `row` from the caret's line (`:73`) and `col` by counting pipes before the caret (`:83-84`), so the widget's only job is to put the caret where the user pointed:

```ts
function runOnCell(view: EditorView, dom: HTMLElement, row: number, col: number, cmd: StateCommand) {
  const tableFrom = view.posAtDOM(dom);
  const table = findTable(view.state, tableFrom);
  if (!table) return;
  const span = tableCellSpans(view.state, table)[row]?.[col];
  if (!span) return;
  view.dispatch({ selection: EditorSelection.cursor(span.from), userEvent: "select" });
  cmd({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
}
```

Two transactions: a selection-only one that parks the caret in the cell, then the command's own. This works only because `atomicRanges` never rewrites a programmatic selection — verified above, four consumers, none a transaction filter. The command's `caret` hook then dispatches `focusTableCell`, `tableFocusPlugin` consumes it on the next update and defers the actual `.focus()` to a microtask, and `tableCommand`'s `selection: cursor(table.from)` (`:123`) leaves the CM caret parked exactly where the quiet-typing invariant wants it.

Mapping, one line each, no new logic: Insert row above → `tableInsertRowAbove` (`:133`); Insert row below / Tab-at-end / Add row → `tableInsertRowBelow` (`:141`); Delete row → `tableDeleteRow` (`:147`); Insert column left/right / Add column → `tableInsertColumnLeft`/`Right` (`:167-168`); Delete column → `tableDeleteColumn` (`:170`); Align → `tableAlignColumn` (`:176`); Sort → `tableSortByColumn` (`:189`); Format → `tableFormat` (`:186`); Move row → the new `tableMoveRowUp`/`Down`.

### DOM contract

- Root: `<div class="cm-table-widget" data-nodum-table data-table-id="3" data-rows="4" data-cols="3">`
- Native semantics give free roles: `<table>` → `table`, `<tr>` → `row`, `<th scope="col">` → `columnheader`, `<td>` → `cell`.
- Cells: `data-table-cell`, `data-table-row="1"` (0-based, header = 0), `data-table-col="2"`, `data-table-align="center"`, `data-raw="0|1"`, `contenteditable`, `aria-label="Row 1, column 3"` (1-based, body-relative); header cells `aria-label="Column 3 header"`.
- The focused cell additionally carries `data-cell-editing` — the one attribute a test asserts to prove reveal happened at cell granularity, and the one `editor-context-menu.tsx` queries to decide whether to steal focus back.
- Controls: `<button type="button" data-table-control data-table-action="…" aria-label="…">` with actions `insert-row-above`, `insert-row-below`, `delete-row`, `move-row-up`, `move-row-down`, `insert-column-left`, `insert-column-right`, `delete-column`, `align-left|align-center|align-right|align-none`, `sort-asc`, `sort-desc`, `format-table`, `edit-source`, `append-row`, `append-column`. Rail grips: `data-table-action="row-menu" data-table-row="1"` and `column-menu`/`data-table-col`. Adders: `aria-label="Add row"` / `"Add column"`.
- No `data-committing` attribute is needed. Commits are synchronous — there is no debounce, so there is no window in which `modelRef` and the document disagree, and therefore no flush choke point and no data-loss surface. That whole class of bug from Design 3 does not exist here.

### Cell editing host

`<td contenteditable="plaintext-only">` when supported; probe once at module load with `el.contentEditable = "plaintext-only"; supported = el.contentEditable === "plaintext-only"`. Otherwise `contenteditable="true"` plus a `beforeinput` filter that `preventDefault()`s `formatBold`, `formatItalic`, `insertFromPasteAsQuotation` and friends. Nesting an editable host inside CM's widget wrapper works because `WidgetTile.of` sets `dom.contentEditable = "false"` on the wrapper (`index.js:2158-2159`) and a nested `contenteditable="true"` is still a valid innermost editing host.

Two `beforeinput` guards are mandatory, because an emptied cell's span is a zero-length point and the browser will otherwise start eating pipes: `deleteContentBackward` at offset 0 → `preventDefault()` and move to the previous cell's end; `deleteContentForward` at the end → `preventDefault()` and move to the next cell's start.

The phantom CM caret needs no handling. With focus on the cell, `root.activeElement !== contentDOM`, CM drops `.cm-focused`, and its base theme hides the drawn cursor: `.cm-cursor { display: none }` (`index.js:6897-6899`) is overridden only by `&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor { display: block }` (`:6921-6923`). `drawSelection()` (`markdown-editor.tsx:78`) goes quiet on its own.

### IME and paste

**IME.** `compositionstart` sets `st.composing`, `compositionend` clears it and commits once. `reconcile` skips a composing cell entirely — overwriting mid-composition cancels it in Chrome. `blockWidgetField.update` additionally skips the rebuild while any live table is composing, because a remote Yjs transaction arriving mid-composition carries no `input.type.compose` annotation and the existing guard at `:427` would not catch it.

**Paste.** One listener on the widget root, `preventDefault()` always:
1. Prefer `text/html`; if `DOMParser` finds a `<table>`, take `td|th` `textContent` per row. Otherwise `text/plain`.
2. Single value (no `\t`, no `\n`) → insert at the caret with the Range API, then the normal `input` commit path escapes `|` → `\|`.
3. Grid (contains `\t` or `\n`, ≥2 columns or ≥2 rows) → `parseGrid`, splice into the model starting at the focused cell growing rows/columns as needed, and dispatch **one** transaction through `render()` with `userEvent: "input.paste"` and `isolateHistory.of("full")`. This is the one sanctioned whole-table write from the widget: it is one logical edit and deserves one transaction. It is also genuine Excel/Notion behaviour, not a workaround.
4. Multi-line non-grid text → newlines become `<br>` inside the single cell.

---

## 7. Undo and collaboration

### Undo

- **Typing in one cell** → `userEvent: "input.type"`, which `joinableUserEvent = /^(input\.type|delete)($|\.)/` (`@codemirror/commands/dist/index.js:471`) joins across the 500ms `newGroupDelay` (`:212`, `:487`). Undo removes a burst of typing — per-edit, not per-character, never a whole-table replacement.
- **Moving to a different cell** → the first commit in the new cell carries `isolateHistory.of("before")` (a real annotation, `:199`, read at `:237`), forcing a boundary. Fill three cells fast, hit `Mod-z` three times, get three steps. Time-based grouping alone would merge them.
- **Structural ops and grid paste** → `isolateHistory.of("full")`; exactly one undo step, never merged with adjacent typing.
- The parking selection dispatch happens only on `focusin`, so it never lands between two typing transactions and never breaks a group through `selectionsAfter` (`:486`).
- After undo/redo the focused cell's `next !== escapeCell(textContent)`, so `reconcile` overwrites it and re-seats the caret. This is required — an undo the focused cell ignored would leave the DOM permanently out of sync.

### Collaboration

`collabExtension` → `yCollab(ytext, awareness)` (`collab.ts:118-121`) is pushed alongside `blockWidgets()` (`markdown-editor.tsx:120-123`).

- **Local cell edits** go through `view.dispatch` only; the widget never touches `ytext`. Per-keystroke minimal changes propagate exactly like ordinary typing — same volume, same granularity.
- **Remote edit in a different cell** (the common case): that cell's DOM is rewritten, the focused cell is skipped by the echo test, and the caret does not move at all.
- **Remote edit in the focused cell**: the echo test fails, so `reconcile` overwrites and re-seats. No local characters are lost — Yjs has already merged at character granularity, so the incoming text *is* the merged result. Only the caret is at risk, and it is handled by mapping the stored caret offset through `tr.changes` rather than clamping a raw offset. Map with `assoc = -1` so a concurrent remote insert at the exact caret position does not carry the caret to the far side of the peer's text.
- **Remote structural edit**: shape changes, `reconcile` rebuilds the grid, focus is restored to `{row, col}` clamped to the new grid via `pendingFocus`. Visible flicker, correct outcome.
- **Mid-IME remote edit**: `st.composing` short-circuits the focused cell; the commit after `compositionend` re-reads the *current* document span, so it writes on top of the merged text rather than a stale snapshot.
- **Structural commands under collab** are the pre-existing weak spot: `tableCommand` replaced the whole range (`:121-122`), which in `Y.Text` is delete-everything + insert-everything and clobbers a concurrent remote edit anywhere in the table. The new `tableChanges` per-line diff shrinks the blast radius to the rows that actually changed. This is a pre-existing defect, but the controls make those commands one click away instead of three, so it will be hit far more often — ship the diff with the feature.
- **Known gap, shipping as-is**: `yRemoteSelections` emits decorations inside the table's range, which the block replace swallows, so remote carets are invisible inside a rendered table. This is already true today. v2 hook: read `provider.awareness.getStates()`, map each peer's `head` through `tableCellSpans` to a `(row, col)`, and tint that `<td>`'s border with `presenceColor` (`collab.ts:25-29`).
- **Two undo stacks coexist**, pre-existing: `yCollab` is called without options so it installs its default `Y.UndoManager` and a `beforeinput` handler for `historyUndo`/`historyRedo`, while CM's `history()` owns `Mod-z` (`markdown-editor.tsx:79`, `:97`). Our `isolateHistory` affects only CM's stack. Not introduced here; worth a comment in the code.

---

## 8. Ordered implementation steps

Each step is independently verifiable and independently mergeable.

**Step 1 — one parser (own PR, ship first).** Create `table-model.ts` with `splitCells`/`splitRow`/`escapeCell`/`unescapeCell`/`cellWidth`/`isRow`/`isDivider`/`alignOf`. Point `table-commands.ts` and `TableWidget.toDOM` at it; make `render()` pad on `cellWidth`. Add vitest. *Verify:* a note containing `| a \| b | c |` renders as two cells (not three) in the read-only widget, and "Insert column right" on it produces a three-column table with `a \| b` intact. This fixes a live data-corruption bug and is valuable on its own.

**Step 2 — `table-commands.ts` API surface.** Export `Table`, `findTable(state, pos?)`, `render`, `tableCellSpans`, `tableChanges`; add the `caret?` hook, `tableMoveRowUp/Down`, `tablePasteGrid`. *Verify:* unit tests for `tableCellSpans` on `insertTable`'s output (every body cell is a zero-width span at `line.from + pipeIndex + 2`); existing e2e `editor-context-menu.spec.ts` table test still passes; right-click → "Insert row below" now leaves the caret in the new row, checked by typing immediately afterwards.

**Step 3 — widget identity.** Change `blockWidgetField`'s value to `TableIdentity`, add the mapping + id reuse, keep emitting the old read-only `TableWidget`. *Verify:* a temporary `console.log` (or a `data-table-id` attribute) shows a table's id is stable while typing in a paragraph above it, across undo, and across a remote edit.

**Step 4 — `EditableTableWidget`, read path only.** New `table-widget.ts`; cells get their `data-*` attributes and render through `renderCellHTML`; `eq`/`updateDOM`/`ignoreEvent`/`destroy` per §3; the `selectionTouches` gate for tables is deleted; the cross-DOM guard is in place. Cells are **not** yet contenteditable. *Verify:* two tables in one note, edit the first — the second's DOM node identity is unchanged (`data-table-id` stable, no flash) and their bodies do not swap.

**Step 5 — contenteditable cells + commit.** `wire()`, `focusin`/`focusout`, `mousedown` swap, `input` → `commit`, the `reconciling` guard, the parking dispatch, `beforeinput` delete guards. *Verify:* type five characters one at a time into a cell; the cell reads exactly what you typed, and Source mode shows the change confined to that cell — every other byte of the table identical.

**Step 6 — controls.** Rails, adders, toolbar, `runOnCell`, `focusTableCell` + `tableFocusPlugin` with deferred focus, `editor-context-menu.tsx`'s conditional `view.focus()`, the `syncCaretToPointer` bail, the Move-row and Edit-source menu items. *Verify:* click "Add row" **while a cell has focus** — no exception in the console (this is the regression the re-entrancy guard exists for), the table grows, and focus lands in the new row's first cell.

**Step 7 — keyboard, IME, paste.** Tab/Enter/Escape/arrow navigation, `Mod-z`, composition guards, the paste pipeline, `rawTableSource` escape hatch. *Verify:* Tab from the last cell appends a row and focuses it; pasting `a\tb\nc\td` into a 2-column table adds two rows; IME composition in a cell commits once on `compositionend`.

**Step 8 — `insertTable` opens a cell.** Append `focusTableCell.of({row:1,col:0})` to `insertTable`'s transaction. *Verify:* right-click → Insert → Table, then type immediately without touching the mouse; the text lands in the first body cell.

**Step 9 — flag, styling, tests.** `editableTables` setting threaded through; `globals.css`; `web/e2e/table-edit.spec.ts`; `sourceText` extracted into `helpers.ts`; extend `collab.spec.ts`. *Verify:* `make web-lint web-build e2e`.

---

## 9. The e2e cases, and what to break to prove each is not vacuous

`web/e2e/table-edit.spec.ts`, using `signupFreshUser`, `createNoteViaApi`, `openNoteFromExplorer`, `editorSurface`, and the newly extracted `sourceText`.

**1. Caret survives every keystroke — the decisive test.** Click `[data-table-cell][data-table-row="1"][data-table-col="0"]`, then `page.keyboard.type("hello", { delay: 30 })`, and assert the cell's text is exactly `hello`.
*Break it:* remove the echo test from `reconcile` (always overwrite the focused cell). The cell reads `olleh` (caret collapsed to 0 each keystroke) or `h`. This is the permanent canary for CodeMirror tile-reuse regressions — `Tile`, `WidgetType.compare` and `readMutation`'s widget short-circuit are `@internal` even though `eq`/`updateDOM`/`ignoreEvent` are public, so pin `@codemirror/view` and let this test guard the minor upgrades.

**2. The edit is minimal in the source.** After test 1, switch to Source mode and assert the **full** document string equals the fixture with only that one cell substituted.
*Break it:* make `commit` call `render()` over the whole table. Padding changes on other lines and the byte-exact comparison fails. A `toContain("| hello")` assertion would pass — hence the full-string compare.

**3. No reveal on click.** Click a cell; assert `[data-nodum-table]` is still visible and `[data-cell-editing]` is set on that cell.
*Break it:* restore the `selectionTouches` gate at `block-widgets.ts:377`. The widget vanishes and the raw pipes appear — the exact regression this feature exists to prevent.

**4. Undo is per cell visit.** Type `abc` in one cell, `Tab`, type `xyz`, one `ControlOrMeta+z` → `xyz` gone and `abc` intact; a second → `abc` gone.
*Break it:* drop `isolateHistory.of("before")`. Both bursts fall inside `newGroupDelay` and one undo removes both. Removing the `userEvent: "input.type"` instead makes undo per-character and the first assertion fails the other way, so the test pins both ends.

**5. Add row / add column round-trip.** Click `[aria-label="Add row"]`; assert `tbody tr` count +1 and that the source gained one `|` line. Then `[aria-label="Add column"]`; assert every `tr` gained a cell and the source contains `New column`.
*Break it:* have the adder call `tableInsertRowBelow` without first parking the caret. The row is appended after the header rather than after the pointed row, and the row-count-plus-position assertion fails.

**6. Add row while a cell has focus does not throw.** Click a cell, type one character, click `[aria-label="Add row"]`; assert no page error (`page.on("pageerror")` collected into an array asserted empty) and that focus is in the new row (`[data-cell-editing][data-table-row="2"]`).
*Break it:* remove the `reconciling` guard or make `scheduleFocus` synchronous. `"Calls to EditorView.update are not allowed while an update is in progress"` (`index.js:7949`) surfaces as a page error.

**7. Pipes survive.** Type `a|b` into a cell; assert the source contains `a\|b`, that the table still has its original column count, and that "Insert column right" afterwards still produces the right shape.
*Break it:* revert `splitCells` to `.split("|")`. The rendered widget shows an extra column and the structural command rewrites the row destructively.

**8. Tab appends and focuses.** Tab from the last cell; assert a new row exists and `[data-cell-editing]` is on its first cell.
*Break it:* drop the `caret` hook from `tableInsertRowBelow`; focus lands nowhere (or `tableCommand`'s `cursor(table.from)` leaves it at the header) and the assertion fails.

**9. TSV paste.** Paste `a\tb\nc\td` into a cell of a 2-column table; assert two new body rows and one undo step (`Mod-z` restores the original table entirely).
*Break it:* commit the paste cell-by-cell. Undo then takes four presses.

**10. Escape hatch.** Click `[data-table-action="edit-source"]`; assert `[data-nodum-table]` disappears and the raw pipes appear in `editorSurface`. Click elsewhere; assert the widget returns.
*Break it:* never clear `rawId`; the table never comes back.

**11. Existing specs pass untouched.** `notes.spec.ts:198-199` (`.cm-table-widget table`, `.cm-table-widget td strong`) and `editor-context-menu.spec.ts:137-160` (right-click a rendered table → Insert row below → 4 pipe lines; → Insert column right → `New column`).
*Break it:* stop rendering inline markdown in unfocused cells; the `td strong` assertion fails. Return `true` from `ignoreEvent` for `contextmenu`; the right-click path dies.

**12. Collab — extend `collab.spec.ts`.** Two contexts on one note; focus a cell in A and type; from B type into a *different* cell; assert A's cell text and caret are undisturbed and B's text appears in A's table.
*Break it:* remove the echo test's `cell === focused` condition. A's cell is overwritten by the reconcile that B's transaction triggers and A loses its caret mid-word.

---

## Residual risks worth telling the maintainer before starting

- **Two nested editing hosts inside one contenteditable tree is the structural bet.** Every browser quirk around nested hosts lands on us and CodeMirror upstream will not fix them — its contract is that widgets are inert. Expect Safari occasionally painting a caret at the host boundary, GBoard batching `beforeinput` across cell boundaries, and spellcheck underlines not clearing when a cell swaps raw↔rendered. The CM 6.43 internals genuinely cooperate, but this will be the highest-maintenance widget in the codebase. Ship it behind `editorSettings.editableTables`.
- **`ignoreEvent` is all-or-nothing per event.** Returning true for cell events also removes CM's mouse selection from those cells: a drag started *inside* a cell selects within the cell rather than extending the document selection across the table. Returning false for the widget's padding and rails mitigates it (a drag started outside still crosses), but the residual gap is unfixable with the public API.
- **`contenteditable="plaintext-only"` is not universal.** The `true` fallback lets browser gestures inject markup; `textContent` flattens it on the next commit, but the reconcile that follows then rewrites the cell and loses the caret. Low frequency, unpleasant.
- **Ragged source padding while typing** (§4) is visible to anyone reading the markdown in git.
- **Remote presence inside a table is invisible** — pre-existing, unchanged, with the v2 hook noted in §7.
- **Effort: XL.** Steps 1–3 are small and independently valuable; steps 5–7 are where the time goes.