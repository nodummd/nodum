/**
 * Block-level Live Preview widgets — StateField-based, per the research
 * mandate: block replace decorations MUST come from a StateField (ViewPlugins
 * may not emit them), with IME-compose guards and atomicRanges so cursor
 * motion skips over replaced regions.
 *
 * Covers: GFM tables, YAML frontmatter (properties card), $$ block math,
 * fenced code (shiki-highlighted; ```mermaid fences render diagrams).
 * Reveal-on-cursor applies: a region touched by the selection renders raw.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import { renderMathHTML } from "./math";
import { EditableTableWidget, tableFocusPlugin } from "./table-widget";
import { renderMermaidSvg } from "./mermaid";
import { cachedHighlight, highlightToHtml } from "./shiki";

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

// ── Table widget ─────────────────────────────────────────────────────────────


// ── Properties (frontmatter) widget — field-level editing ────────────────────

interface PropField {
  key: string;
  keyLine: number;
  /** Scalar raw value ("" when the key introduces a list). */
  value: string;
  /** For lists: [lineIdx, itemText] per `- item` line. */
  items: [number, string][];
}

function unquote(v: string): string {
  return v.replace(/^["']|["']$/g, "");
}

/** Quote a scalar for YAML when it needs it. */
function yamlScalar(v: string): string {
  if (v === "") return '""';
  if (/^[\w./-]+$/.test(v) || /^-?\d+(\.\d+)?$/.test(v) || v === "true" || v === "false") return v;
  return JSON.stringify(v);
}

/** Light structural parse of top-level `key: value` + nested `- item` lines. */
function parseFields(lines: string[]): PropField[] {
  const fields: PropField[] = [];
  let current: PropField | null = null;
  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) return;
    const listMatch = /^\s+-\s+(.*)$/.exec(line);
    if (listMatch && current) {
      current.items.push([idx, unquote(listMatch[1])]);
      return;
    }
    const kv = /^([\w][\w -]*):\s*(.*)$/.exec(line);
    if (kv) {
      current = { key: kv[1], keyLine: idx, value: unquote(kv[2]), items: [] };
      fields.push(current);
    }
  });
  return fields;
}

class PropertiesWidget extends WidgetType {
  constructor(
    readonly yaml: string,
    /** Absolute doc range of the whole frontmatter block (incl. delimiters). */
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  override eq(other: PropertiesWidget): boolean {
    return other.yaml === this.yaml && other.from === this.from && other.to === this.to;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-properties-widget";
    const heading = document.createElement("div");
    heading.className = "cm-properties-heading";
    heading.textContent = "Properties";
    wrap.appendChild(heading);

    const lines = this.yaml.split("\n");
    const commit = (nextLines: string[]) => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: `---\n${nextLines.join("\n")}\n---` },
      });
    };

    const grid = document.createElement("div");
    grid.className = "cm-properties-grid";

    for (const field of parseFields(lines)) {
      const keyEl = document.createElement("div");
      keyEl.className = "cm-properties-key";
      keyEl.textContent = field.key;
      grid.appendChild(keyEl);

      const val = document.createElement("div");
      val.className = "cm-properties-value";

      if (field.items.length > 0) {
        // List → removable pills + inline add
        for (const [lineIdx, item] of field.items) {
          const pill = document.createElement("span");
          pill.className = "cm-properties-pill";
          pill.textContent = item;
          const rm = document.createElement("button");
          rm.type = "button";
          rm.textContent = "×";
          rm.className = "cm-properties-pill-remove";
          rm.setAttribute("aria-label", `Remove ${item} from ${field.key}`);
          rm.onclick = () => {
            commit(lines.filter((_, i) => i !== lineIdx));
          };
          pill.appendChild(rm);
          val.appendChild(pill);
        }
        const add = document.createElement("input");
        add.className = "cm-properties-add";
        add.placeholder = "+";
        add.setAttribute("aria-label", `Add to ${field.key}`);
        const commitAdd = () => {
          const v = add.value.trim();
          if (!v) return;
          const lastItemLine = field.items[field.items.length - 1][0];
          const next = [...lines];
          next.splice(lastItemLine + 1, 0, `  - ${v}`);
          commit(next);
        };
        add.onkeydown = (e) => {
          if (e.key === "Enter") commitAdd();
        };
        add.onblur = commitAdd;
        val.appendChild(add);
      } else if (field.value === "true" || field.value === "false") {
        // Boolean → checkbox, committed immediately
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = field.value === "true";
        box.className = "cm-properties-checkbox";
        box.setAttribute("aria-label", `${field.key} value`);
        box.onchange = () => {
          const next = [...lines];
          next[field.keyLine] = `${field.key}: ${box.checked ? "true" : "false"}`;
          commit(next);
        };
        val.appendChild(box);
      } else {
        // Scalar → text/date input, committed on Enter or blur
        const input = document.createElement("input");
        input.type = /^\d{4}-\d{2}-\d{2}$/.test(field.value) ? "date" : "text";
        input.value = field.value;
        input.className = "cm-properties-input";
        input.setAttribute("aria-label", `${field.key} value`);
        const commitScalar = () => {
          const v = input.value.trim();
          if (v === field.value) return;
          const next = [...lines];
          next[field.keyLine] = `${field.key}: ${yamlScalar(v)}`;
          commit(next);
        };
        input.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitScalar();
          }
        };
        input.onblur = commitScalar;
        val.appendChild(input);
      }
      grid.appendChild(val);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  override ignoreEvent(event: Event): boolean {
    // Events inside form controls belong to the widget (else CM would treat
    // the click as cursor placement and reveal the raw YAML mid-edit)
    const target = event.target as HTMLElement | null;
    return Boolean(target?.closest?.("input, button"));
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

// ── Fenced code widget ───────────────────────────────────────────────────────

class CodeFenceWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }

  override eq(other: CodeFenceWidget): boolean {
    return other.lang === this.lang && other.code === this.code;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-code-widget";

    if (this.lang === "mermaid") {
      wrap.classList.add("cm-mermaid-widget");
      const code = this.code;
      void renderMermaidSvg(code)
        .then((svg) => {
          wrap.innerHTML = svg;
        })
        .catch(() => {
          // Parse error while assembling a diagram — show the raw source
          const pre = document.createElement("pre");
          const codeEl = document.createElement("code");
          codeEl.textContent = code;
          pre.appendChild(codeEl);
          wrap.replaceChildren(pre);
        });
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      wrap.appendChild(pre);
      return wrap;
    }

    if (this.lang) {
      const badge = document.createElement("div");
      badge.className = "cm-code-lang";
      badge.textContent = this.lang;
      wrap.appendChild(badge);
    }
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = this.code;
    pre.appendChild(codeEl);
    wrap.appendChild(pre);

    const cached = cachedHighlight(this.code, this.lang);
    const apply = (html: string) => {
      pre.outerHTML = html; // shiki emits its own <pre class="shiki">
      wrap.classList.add("is-highlighted");
    };
    if (cached) apply(cached);
    else {
      void highlightToHtml(this.code, this.lang).then((html) => {
        if (wrap.querySelector("pre") === pre) apply(html);
      });
    }
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** Split a fence's full source into (lang, inner code). */
function parseFence(source: string): { lang: string; code: string } {
  const lines = source.split("\n");
  const lang = (lines[0].replace(/^[`~]+/, "").trim().split(/\s+/)[0] ?? "").toLowerCase();
  const closed = lines.length > 1 && /^[`~]{3,}\s*$/.test(lines[lines.length - 1].trim());
  const code = lines.slice(1, closed ? -1 : undefined).join("\n");
  return { lang, code };
}

// ── StateField ───────────────────────────────────────────────────────────────

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = state.doc.toString();

  // Frontmatter: must start at position 0
  const fm = /^---\n([\s\S]*?)\n(?:---|\.\.\.)(?:\n|$)/.exec(doc);
  if (fm && !selectionTouches(state, 0, fm[0].length)) {
    const end = fm[0].length - (fm[0].endsWith("\n") ? 1 : 0);
    decorations.push(
      Decoration.replace({ widget: new PropertiesWidget(fm[1], 0, end), block: true }).range(0, end),
    );
  }

  // GFM tables + fenced code from the syntax tree
  const fenceRanges: [number, number][] = [];
  // Ordinal position of each table in the document. Stable while typing in a
  // cell, so the widget's eq() keeps the same identity and CodeMirror reuses
  // the DOM node the caret lives in.
  let tableOrdinal = 0;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table") {
        // No selectionTouches gate: the table is EDITABLE now, so revealing the
        // raw markdown when the selection enters it would make the table vanish
        // at exactly the moment the user clicks in to edit a cell. The caret
        // parked at the block start by the widget would trip that gate on every
        // focus. Source mode is where the pipes live.
        //
        // The id is the table's ordinal within the document, which is stable
        // while you type in a cell — unlike a document offset, which changes on
        // every edit above and would rebuild the DOM under the user's caret.
        decorations.push(
          Decoration.replace({
            widget: new EditableTableWidget(
              tableOrdinal++,
              state.doc.sliceString(node.from, node.to),
            ),
            block: true,
          }).range(node.from, node.to),
        );
        return false;
      }
      if (node.name === "FencedCode") {
        fenceRanges.push([node.from, node.to]);
        if (!selectionTouches(state, node.from, node.to)) {
          const { lang, code } = parseFence(state.doc.sliceString(node.from, node.to));
          decorations.push(
            Decoration.replace({ widget: new CodeFenceWidget(lang, code), block: true }).range(
              node.from,
              node.to,
            ),
          );
        }
        return false;
      }
    },
  });

  // $$ block math (may span lines; skip regions inside frontmatter or code fences)
  const mathRe = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  while ((m = mathRe.exec(doc)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (fm && start < fm[0].length) continue;
    if (fenceRanges.some(([f, t]) => start < t && end > f)) continue;
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
  return [blockWidgetField, tableFocusPlugin];
}
