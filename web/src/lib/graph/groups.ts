/**
 * Graph color groups — Obsidian's "Groups" feature: each group is a query
 * plus a color; the FIRST group whose query matches a node wins (top-down
 * order, Obsidian rule). Queries understand path:/tag:/file: operators;
 * anything else matches title or path as plain text.
 */

export interface GraphGroup {
  query: string;
  color: string;
}

/** Obsidian-ish categorical palette for newly added groups. */
export const GROUP_PALETTE = [
  "#eb3b5a",
  "#fa8231",
  "#f7b731",
  "#20bf6b",
  "#0fb9b1",
  "#2d98da",
  "#8854d0",
  "#a5b1c2",
];

interface GroupableNode {
  title: string;
  path: string;
  tags: string[];
}

function matches(node: GroupableNode, q: string): boolean {
  if (q.startsWith("path:")) {
    const v = q.slice(5).trim();
    return v !== "" && node.path.toLowerCase().includes(v);
  }
  if (q.startsWith("tag:")) {
    const v = q.slice(4).trim().replace(/^#/, "");
    return (
      v !== "" &&
      node.tags.some((t) => {
        const tl = t.toLowerCase();
        return tl === v || tl.startsWith(`${v}/`);
      })
    );
  }
  if (q.startsWith("file:")) {
    const v = q.slice(5).trim();
    return v !== "" && node.title.toLowerCase().includes(v);
  }
  return node.title.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
}

/** Index of the first matching group, or -1. */
export function matchGroupIndex(node: GroupableNode, groups: GraphGroup[]): number {
  for (let i = 0; i < groups.length; i++) {
    const q = groups[i].query.trim().toLowerCase();
    if (q && matches(node, q)) return i;
  }
  return -1;
}

/** Hex color of the first matching group, or null. */
export function matchGroupHex(node: GroupableNode, groups: GraphGroup[]): string | null {
  const i = matchGroupIndex(node, groups);
  return i >= 0 ? groups[i].color : null;
}
