/**
 * Explorer colours, shared by the file tree and the graph.
 *
 * A colour picked from the explorer's right-click menu is stored per vault as
 * a flat {itemId: hex} map (folder ids and note ids in the same map). Folders
 * pass their colour down to every descendant that sets none, so colouring a
 * folder colours its notes — in the tree AND on the graph canvas.
 */

import type { TreeItem } from "@/lib/api/types";
import { matchGroupHex, type GraphGroup } from "@/lib/graph/groups";

/** {itemId: hex} — the vault's `settings.itemColors`. */
export type ItemColorMap = Record<string, string>;

/** Read the colour map off a vault's settings blob. */
export function itemColorsOf(settings: unknown): ItemColorMap {
  return (settings as { itemColors?: ItemColorMap } | undefined)?.itemColors ?? {};
}

/**
 * Effective colour of every folder, keyed by folder PATH (own colour, else the
 * nearest coloured ancestor's). Paths, not ids, because a graph node carries
 * `folder` — the path prefix of its own path — and the server derives both
 * from the same `folders.path` column, so the lookup is an exact match.
 */
export function folderColorsByPath(items: TreeItem[], colors: ItemColorMap): Map<string, string> {
  const byPath = new Map<string, string>();
  const walk = (nodes: TreeItem[], inherited?: string) => {
    for (const item of nodes) {
      if (item.type !== "folder") continue;
      const color = colors[item.id] ?? inherited;
      if (color) byPath.set(item.path, color);
      walk(item.children, color);
    }
  };
  walk(items);
  return byPath;
}

interface ColorableNode {
  id: string;
  title: string;
  path: string;
  folder: string;
  tags: string[];
}

/**
 * The colour a graph node should paint with, or null for the default node
 * colour. Most specific wins:
 *
 *   1. a colour set on the note itself   (one item — an explicit override)
 *   2. the first matching graph group    (a query the user wrote)
 *   3. the colour inherited from its folder chain
 */
export function nodeColorHex(
  node: ColorableNode,
  groups: GraphGroup[],
  colors: ItemColorMap,
  folderColors: Map<string, string>,
): string | null {
  const own = colors[node.id];
  if (own) return own;
  return matchGroupHex(node, groups) ?? folderColors.get(node.folder) ?? null;
}
