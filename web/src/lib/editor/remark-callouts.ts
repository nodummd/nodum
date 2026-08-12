/**
 * remark plugin: blockquotes whose first line is `[!type](+/-) Title` become
 * `<callout>` hast nodes rendered by the CalloutBox component.
 */

import type { Blockquote, Paragraph, Root, Text } from "mdast";
import { visit } from "unist-util-visit";

import { CALLOUT_MARKER_RE } from "./callouts";

export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (!first || first.type !== "paragraph") return;
      const firstText = first.children[0];
      if (!firstText || firstText.type !== "text") return;

      const newlineIdx = firstText.value.indexOf("\n");
      const firstLine = newlineIdx >= 0 ? firstText.value.slice(0, newlineIdx) : firstText.value;
      const match = CALLOUT_MARKER_RE.exec(firstLine);
      if (!match) return;

      const [, type, fold, title] = match;

      // Strip the marker line from the first text node
      if (newlineIdx >= 0) {
        (firstText as Text).value = firstText.value.slice(newlineIdx + 1);
      } else {
        (first as Paragraph).children.shift();
        if (first.children.length === 0) node.children.shift();
      }

      node.data = {
        ...node.data,
        hName: "callout",
        hProperties: {
          calloutType: type.toLowerCase(),
          calloutTitle: title.trim(),
          calloutFold: fold,
        },
      };
    });
  };
}
