/**
 * remark plugin: turn the allowlisted inline HTML from `inline-html.ts` into
 * real elements in the reading view.
 *
 * react-markdown lowers every raw `html` node to a TEXT node, so without this
 * `<span style="color:#e93147">Sönke</span>` is displayed verbatim. Rather than
 * enabling rehype-raw (which parses arbitrary HTML and then subtracts), this
 * recognises only the five tags nodum itself emits and rebuilds them from
 * scratch — anything else keeps rendering as literal text, exactly as before.
 */

import type { Parent, PhrasingContent, Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";

import { INLINE_HTML_CLASS, parseInlineHtml } from "./inline-html";

/** An mdast node carrying to-hast overrides — how a custom node becomes HTML. */
interface HastData {
  hName?: string;
  hProperties?: Record<string, string>;
}

function isHtmlNode(node: RootContent): node is RootContent & { type: "html"; value: string } {
  return node.type === "html";
}

/**
 * Rewrite one parent's children, wrapping `<tag>…</tag>` runs.
 *
 * Scans left to right keeping a stack of open tags, so nesting works and an
 * unmatched tag is simply left in place as the text it already renders as.
 */
function wrapChildren(parent: Parent): boolean {
  const children = parent.children as RootContent[];
  let changed = false;

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!isHtmlNode(node)) continue;
    const open = parseInlineHtml(node.value.trim());
    if (!open || open.kind !== "open") continue;

    // Find the matching close, honouring nested same-tag pairs.
    let depth = 0;
    let closeAt = -1;
    for (let j = i + 1; j < children.length; j++) {
      const other = children[j];
      if (!isHtmlNode(other)) continue;
      const parsed = parseInlineHtml(other.value.trim());
      if (!parsed || parsed.tag !== open.tag) continue;
      if (parsed.kind === "open") {
        depth++;
        continue;
      }
      if (depth > 0) {
        depth--;
        continue;
      }
      closeAt = j;
      break;
    }
    if (closeAt === -1) continue; // unmatched — leave it as literal text

    const properties: Record<string, string> = {
      className: `${INLINE_HTML_CLASS} nodum-inline-${open.tag}`,
    };
    if (open.style) properties.style = open.style;

    const wrapped: PhrasingContent & { data: HastData } = {
      type: "emphasis", // structural carrier; hName below decides the real tag
      children: children.slice(i + 1, closeAt) as PhrasingContent[],
      data: { hName: open.tag, hProperties: properties },
    };

    children.splice(i, closeAt - i + 1, wrapped as RootContent);
    changed = true;
    // Re-examine this index: the replacement may itself contain more pairs.
    i--;
  }

  return changed;
}

export function remarkInlineHtml() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!("children" in node) || !Array.isArray((node as Parent).children)) return;
      const parent = node as Parent;
      if (parent.children.some((c) => (c as RootContent).type === "html")) {
        wrapChildren(parent);
      }
    });
  };
}
