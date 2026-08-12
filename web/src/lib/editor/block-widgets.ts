/**
 * Block-level Live Preview widgets — StateField-based, per the research
 * mandate: block replace decorations MUST come from a StateField (ViewPlugins
 * may not emit them), with IME-compose guards and atomicRanges so cursor
 * motion skips over replaced regions.
 *
 * Covers: GFM tables, YAML frontmatter (properties card), $$ block math.
 * Reveal-on-cursor applies: a region touched by the selection renders raw.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import { renderMathHTML } from "./math";

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

// ── Table widget ─────────────────────────────────────────────────────────────

/** Minimal inline-markdown for table cells: bold/italic/code/strike as text styling. */
function renderCellHTML(cell: string): string {
  const escaped = cell
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const lines = this.source
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("|") || l.includes("|"));
    const parseRow = (line: string): string[] =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());

    const wrap = document.createElement("div");
    wrap.className = "cm-table-widget";
    const table = document.createElement("table");
    wrap.appendChild(table);

    lines.forEach((line, i) => {
      if (i === 1 && /^[\s|:-]+$/.test(line)) return; // separator row
      const tr = document.createElement("tr");
      for (const cell of parseRow(line)) {
        const td = document.createElement(i === 0 ? "th" : "td");
        td.innerHTML = renderCellHTML(cell);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    });
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false; // click → cursor enters the region → raw syntax reveals
  }
}

// ── Properties (frontmatter) widget ──────────────────────────────────────────

class PropertiesWidget extends WidgetType {
  constructor(readonly yaml: string) {
    super();
  }

  override eq(other: PropertiesWidget): boolean {
    return other.yaml === this.yaml;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-properties-widget";
    const heading = document.createElement("div");
    heading.className = "cm-properties-heading";
    heading.textContent = "Properties";
    wrap.appendChild(heading);

    // Light YAML display parse: top-level `key: value` plus `- item` lists.
    const grid = document.createElement("div");
    grid.className = "cm-properties-grid";
    let currentKeyEl: HTMLElement | null = null;
    let listBuffer: string[] = [];

    const flushList = () => {
      if (currentKeyEl && listBuffer.length > 0) {
        const val = document.createElement("div");
        val.className = "cm-properties-value";
        for (const item of listBuffer) {
          const pill = document.createElement("span");
          pill.className = "cm-properties-pill";
          pill.textContent = item;
          val.appendChild(pill);
        }
        grid.appendChild(val);
      }
      listBuffer = [];
    };

    for (const rawLine of this.yaml.split("\n")) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      const listMatch = /^\s+-\s+(.*)$/.exec(line);
      if (listMatch) {
        listBuffer.push(listMatch[1].replace(/^["']|["']$/g, ""));
        continue;
      }
      const kv = /^([\w][\w -]*):\s*(.*)$/.exec(line);
      if (kv) {
        flushList();
        const keyEl = document.createElement("div");
        keyEl.className = "cm-properties-key";
        keyEl.textContent = kv[1];
        grid.appendChild(keyEl);
        currentKeyEl = keyEl;
        if (kv[2]) {
          const val = document.createElement("div");
          val.className = "cm-properties-value";
          val.textContent = kv[2].replace(/^["']|["']$/g, "");
          grid.appendChild(val);
          currentKeyEl = null;
        }
      }
    }
    flushList();
    wrap.appendChild(grid);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// ── Block math widget ────────────────────────────────────────────────────────

class BlockMathWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: BlockMathWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-math-block";
    el.innerHTML = renderMathHTML(this.source, true);
    return el;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// ── StateField ───────────────────────────────────────────────────────────────

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = state.doc.toString();

  // Frontmatter: must start at position 0
  const fm = /^---\n([\s\S]*?)\n(?:---|\.\.\.)(?:\n|$)/.exec(doc);
  if (fm && !selectionTouches(state, 0, fm[0].length)) {
    decorations.push(
      Decoration.replace({ widget: new PropertiesWidget(fm[1]), block: true }).range(
        0,
        fm[0].length - (fm[0].endsWith("\n") ? 1 : 0),
      ),
    );
  }

  // GFM tables from the syntax tree
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table") {
        if (!selectionTouches(state, node.from, node.to)) {
          decorations.push(
            Decoration.replace({
              widget: new TableWidget(state.doc.sliceString(node.from, node.to)),
              block: true,
            }).range(node.from, node.to),
          );
        }
        return false;
      }
    },
  });

  // $$ block math (may span lines; skip regions inside the frontmatter match)
  const mathRe = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  while ((m = mathRe.exec(doc)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (fm && start < fm[0].length) continue;
    if (!selectionTouches(state, start, end)) {
      decorations.push(
        Decoration.replace({ widget: new BlockMathWidget(m[1].trim()), block: true }).range(start, end),
      );
    }
  }

  return Decoration.set(decorations, true);
}

const blockWidgetField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },
  update(deco, tr) {
    // IME-compose guard: never rebuild mid-composition (stale offsets crash CM)
    if (tr.isUserEvent("input.type.compose")) return deco.map(tr.changes);
    if (tr.docChanged || tr.selection) return buildBlockDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

export function blockWidgets(): Extension {
  return blockWidgetField;
}
