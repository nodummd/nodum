/**
 * Live Preview decorations — Obsidian's reveal-on-cursor editing mode.
 *
 * The document is always plain markdown; formatting renders in place and
 * syntax marks hide, EXCEPT where the selection touches the enclosing
 * element — there the raw syntax reappears (docs/research/DECISIONS.md §2.1).
 *
 * Inline marks are computed in a ViewPlugin over visible ranges; heading
 * sizes come from line classes so line height never jumps; checkbox widgets
 * resolve their position via posAtDOM at click time (never stale offsets).
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

import { resolveAttachmentUrl } from "./attachment-urls";
import { CALLOUT_MARKER_RE, calloutDefaultTitle, calloutIconElement, calloutType } from "./callouts";
import { isImageTarget, parseWikiLinkText } from "./markdown-extensions";
import { renderMathHTML } from "./math";

/** Does any selection range touch [from, to]? (touch = reveal raw syntax) */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function selectionTouchesLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return selectionTouches(state, line.from, line.to);
}

const hideMark = Decoration.replace({});

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-task-checkbox";
    box.setAttribute("aria-label", this.checked ? "Completed task" : "Open task");
    return box;
  }

  override ignoreEvent(): boolean {
    return false; // let mousedown reach our handler
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-bullet";
    el.textContent = "•";
    return el;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.display ? "cm-math-block" : "cm-math-inline";
    el.innerHTML = renderMathHTML(this.source, this.display);
    return el;
  }

  override ignoreEvent(): boolean {
    return false; // click puts the cursor there → syntax reveals
  }
}

class ImageEmbedWidget extends WidgetType {
  constructor(
    readonly vaultId: string,
    readonly filename: string,
    readonly width: number | null,
  ) {
    super();
  }

  override eq(other: ImageEmbedWidget): boolean {
    return (
      other.vaultId === this.vaultId && other.filename === this.filename && other.width === this.width
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-image-embed";
    const img = document.createElement("img");
    img.alt = this.filename;
    if (this.width) img.style.maxWidth = `${String(this.width)}px`;
    wrap.appendChild(img);
    void resolveAttachmentUrl(this.vaultId, this.filename).then((url) => {
      if (url) img.src = url;
      else wrap.classList.add("cm-image-embed-missing");
    });
    return wrap;
  }
}

class CalloutHeaderWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly title: string,
  ) {
    super();
  }

  override eq(other: CalloutHeaderWidget): boolean {
    return other.type === this.type && other.title === this.title;
  }

  override toDOM(): HTMLElement {
    const info = calloutType(this.type);
    const el = document.createElement("span");
    el.className = "cm-callout-header";
    el.style.setProperty("--callout-color", info.color);
    el.appendChild(calloutIconElement(info));
    const label = document.createElement("span");
    label.textContent = this.title || calloutDefaultTitle(info.name);
    el.appendChild(label);
    return el;
  }
}

function buildDecorations(view: EditorView, vaultId: string | null): DecorationSet {
  const { state } = view;
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const name = node.name;

        // ── Headings: line class + hidden # marks ─────────────────────
        if (name.startsWith("ATXHeading")) {
          const level = Number(name.slice("ATXHeading".length)) || 1;
          const line = state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: `cm-h cm-h${level}` }).range(line.from));
          return;
        }
        if (name === "HeaderMark") {
          if (!selectionTouchesLine(state, node.from)) {
            // hide "# " including the following space
            const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
            decorations.push(hideMark.range(node.from, end));
          }
          return;
        }

        // ── Inline formatting: style content, hide marks when outside ─
        if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
          const cls =
            name === "StrongEmphasis"
              ? "cm-strong"
              : name === "Emphasis"
                ? "cm-em"
                : "cm-strike";
          decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to));
          return;
        }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          const parent = node.node.parent;
          if (parent && !selectionTouches(state, parent.from, parent.to)) {
            decorations.push(hideMark.range(node.from, node.to));
          }
          return;
        }

        if (name === "InlineCode") {
          decorations.push(Decoration.mark({ class: "cm-inline-code" }).range(node.from, node.to));
          return;
        }
        if (name === "CodeMark") {
          const parent = node.node.parent;
          if (
            parent?.name === "InlineCode" &&
            !selectionTouches(state, parent.from, parent.to)
          ) {
            decorations.push(hideMark.range(node.from, node.to));
          }
          return;
        }

        // ── ==Highlight== ─────────────────────────────────────────────
        if (name === "HighlightInline") {
          decorations.push(Decoration.mark({ class: "cm-highlight" }).range(node.from, node.to));
          if (!selectionTouches(state, node.from, node.to)) {
            decorations.push(hideMark.range(node.from, node.from + 2));
            decorations.push(hideMark.range(node.to - 2, node.to));
          }
          return;
        }

        // ── Inline math ───────────────────────────────────────────────
        if (name === "InlineMath") {
          if (!selectionTouches(state, node.from, node.to)) {
            const source = state.doc.sliceString(node.from + 1, node.to - 1);
            decorations.push(
              Decoration.replace({ widget: new MathWidget(source, false) }).range(node.from, node.to),
            );
          } else {
            decorations.push(Decoration.mark({ class: "cm-math-source" }).range(node.from, node.to));
          }
          return;
        }

        // ── Wikilinks & embeds ────────────────────────────────────────
        if (name === "WikiLink" || name === "Embed") {
          const isEmbed = name === "Embed";
          const open = node.from + (isEmbed ? 3 : 2);
          const close = node.to - 2;
          const inner = state.doc.sliceString(open, close);
          const { target, alias } = parseWikiLinkText(inner);
          const touched = selectionTouches(state, node.from, node.to);

          // Image embeds render inline: ![[img.png]] / ![[img.png|320]]
          if (isEmbed && isImageTarget(target) && !touched && vaultId) {
            const width = alias && /^\d+$/.test(alias) ? Number(alias) : null;
            decorations.push(
              Decoration.replace({
                widget: new ImageEmbedWidget(vaultId, target, width),
                block: false,
              }).range(node.from, node.to),
            );
            return;
          }

          decorations.push(
            Decoration.mark({
              class: "cm-wikilink",
              attributes: { "data-wikilink-target": target },
            }).range(node.from, node.to),
          );

          if (!touched) {
            // hide ![[ / [[ and ]]
            decorations.push(hideMark.range(node.from, open));
            decorations.push(hideMark.range(close, node.to));
            if (alias !== null) {
              // show only the alias: hide "target#heading|"
              const pipe = state.doc.sliceString(open, close).indexOf("|");
              if (pipe >= 0) decorations.push(hideMark.range(open, open + pipe + 1));
            }
          }
          return;
        }

        // ── Tags ──────────────────────────────────────────────────────
        if (name === "Hashtag") {
          decorations.push(Decoration.mark({ class: "cm-hashtag" }).range(node.from, node.to));
          return;
        }

        // ── Markdown links [text](url) ────────────────────────────────
        if (name === "Link") {
          decorations.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
          return;
        }
        if (name === "LinkMark" || name === "URL") {
          const parent = node.node.parent;
          if (
            parent?.name === "Link" &&
            !selectionTouches(state, parent.from, parent.to)
          ) {
            // hide [ ] ( url ) — keep only the link text
            const text = parent.node.getChild("URL");
            if (name === "URL" || text) {
              decorations.push(hideMark.range(node.from, node.to));
            }
          }
          return;
        }

        // ── Task checkboxes ───────────────────────────────────────────
        if (name === "TaskMarker") {
          const touched = selectionTouchesLine(state, node.from);
          const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
          if (!touched) {
            decorations.push(
              Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to),
            );
          }
          const line = state.doc.lineAt(node.from);
          if (checked) {
            decorations.push(Decoration.line({ class: "cm-task-done" }).range(line.from));
          }
          return;
        }

        // ── List bullets ──────────────────────────────────────────────
        if (name === "ListMark") {
          const text = state.doc.sliceString(node.from, node.to);
          if ((text === "-" || text === "*" || text === "+") && !selectionTouchesLine(state, node.from)) {
            // don't replace the marker of a task item (checkbox handles the row)
            const after = state.doc.sliceString(node.to, Math.min(node.to + 4, state.doc.length));
            if (!/^\s*\[[ xX]\]/.test(after)) {
              decorations.push(
                Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
              );
            }
          }
          return;
        }

        // ── Blockquotes, callouts & code fences: line styling ─────────
        if (name === "Blockquote") {
          const startLine = state.doc.lineAt(node.from);
          const endLine = state.doc.lineAt(node.to);

          // Callout? First line reads `> [!type](+/-) Title`
          const afterMark = startLine.text.replace(/^\s*>\s?/, "");
          const callout = CALLOUT_MARKER_RE.exec(afterMark);
          if (callout) {
            const [, rawType, , title] = callout;
            const info = calloutType(rawType);
            for (let l = startLine.number; l <= endLine.number; l++) {
              const line = state.doc.line(l);
              decorations.push(
                Decoration.line({
                  class: "cm-callout-line",
                  attributes: { style: `--callout-color: ${info.color}` },
                }).range(line.from),
              );
            }
            // Replace the `[!type](+/-)` marker (and title when collapsed
            // syntax is hidden) with the rendered header
            if (!selectionTouchesLine(state, startLine.from)) {
              const markerStart = startLine.from + startLine.text.indexOf("[!");
              if (markerStart >= startLine.from) {
                decorations.push(
                  Decoration.replace({
                    widget: new CalloutHeaderWidget(rawType, title.trim()),
                  }).range(markerStart, startLine.to),
                );
              }
            }
            return;
          }

          for (let l = startLine.number; l <= endLine.number; l++) {
            decorations.push(Decoration.line({ class: "cm-blockquote-line" }).range(state.doc.line(l).from));
          }
          return;
        }
        if (name === "QuoteMark") {
          if (!selectionTouchesLine(state, node.from)) {
            const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
            decorations.push(hideMark.range(node.from, end));
          }
          return;
        }
        if (name === "FencedCode") {
          const startLine = state.doc.lineAt(node.from);
          const endLine = state.doc.lineAt(node.to);
          for (let l = startLine.number; l <= endLine.number; l++) {
            decorations.push(Decoration.line({ class: "cm-codeblock-line" }).range(state.doc.line(l).from));
          }
          return;
        }
      },
    });
  }

  // ── Block math: $$…$$ regions (may span lines) ────────────────────
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    const re = /\$\$([\s\S]+?)\$\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (selectionTouches(state, start, end)) {
        decorations.push(Decoration.mark({ class: "cm-math-source" }).range(start, end));
      } else {
        // NOTE: ViewPlugins may not emit block decorations — the widget is
        // inline but styled full-width (StateField migration tracked in the
        // roadmap alongside the properties UI).
        decorations.push(
          Decoration.replace({ widget: new MathWidget(m[1].trim(), true) }).range(start, end),
        );
      }
    }
  }

  return Decoration.set(decorations, true);
}

export interface LivePreviewCallbacks {
  onNavigate?: (target: string) => void;
  vaultId?: string;
}

export function livePreview(callbacks: LivePreviewCallbacks = {}) {
  const vaultId = callbacks.vaultId ?? null;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, vaultId);
      }

      update(update: ViewUpdate) {
        // IME + pointer-drag guards (research: the classic failure modes)
        if (update.transactions.some((tr) => tr.isUserEvent("input.type.compose"))) return;
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, vaultId);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(event, view) {
          if (event.button !== 0) return false; // left button only — never hijack right-click/middle-click
          const target = event.target as HTMLElement;

          // Checkbox toggle — resolve position at event time via posAtDOM
          if (target.classList.contains("cm-task-checkbox")) {
            const pos = view.posAtDOM(target);
            const line = view.state.doc.lineAt(pos);
            const match = /\[([ xX])\]/.exec(line.text);
            if (match && match.index !== undefined) {
              const boxPos = line.from + match.index + 1;
              view.dispatch({
                changes: {
                  from: boxPos,
                  to: boxPos + 1,
                  insert: /[xX]/.test(match[1]) ? " " : "x",
                },
              });
            }
            event.preventDefault();
            return true;
          }

          // Wikilink navigation: plain click when rendered, mod+click always
          const linkEl = target.closest?.("[data-wikilink-target]");
          if (linkEl instanceof HTMLElement) {
            const wikiTarget = linkEl.getAttribute("data-wikilink-target");
            if (wikiTarget && (event.metaKey || event.ctrlKey || !selectionTouchesDOM(view, linkEl))) {
              callbacks.onNavigate?.(wikiTarget);
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
      },
    },
  );
}

function selectionTouchesDOM(view: EditorView, el: HTMLElement): boolean {
  try {
    const pos = view.posAtDOM(el);
    return selectionTouches(view.state, pos, pos + (el.textContent?.length ?? 0));
  } catch {
    return false;
  }
}
