/**
 * Block & heading slicing — Obsidian's `[[Note#Heading]]` and
 * `[[Note#^block-id]]` semantics. Shared by reading-view embeds and the
 * page-preview popover.
 */

const FRONTMATTER_RE = /^---\n[\s\S]*?\n(?:---|\.\.\.)\n?/;

function stripFrontmatter(md: string): string {
  return md.replace(FRONTMATTER_RE, "");
}

/** Escape a block id for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The block containing the ` ^id` marker: a list item keeps its indented
 * children; anything else is the contiguous non-blank paragraph. The marker
 * itself is stripped from the result.
 */
export function sliceBlock(content: string, blockId: string): string | null {
  const lines = stripFrontmatter(content).split("\n");
  const markerRe = new RegExp(`(^|\\s)\\^${escapeRe(blockId)}\\s*$`);
  const idx = lines.findIndex((line) => markerRe.test(line));
  if (idx === -1) return null;

  const listMatch = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(lines[idx]);
  let start = idx;
  let end = idx;
  if (listMatch) {
    // list item + more-indented continuation lines
    const indent = listMatch[1].length;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      if (!next.trim()) break;
      const nextIndent = (/^\s*/.exec(next) as RegExpExecArray)[0].length;
      if (nextIndent <= indent && /^\s*(?:[-*+]|\d+[.)])\s/.test(next)) break;
      if (nextIndent <= indent) break;
      end++;
    }
  } else {
    while (start > 0 && lines[start - 1].trim()) start--;
    while (end + 1 < lines.length && lines[end + 1].trim()) end++;
  }

  const block = lines.slice(start, end + 1).join("\n");
  return block.replace(markerRe, "").trimEnd();
}

/** A heading's section: from the heading line to the next same-or-higher heading. */
export function sliceHeading(content: string, heading: string): string | null {
  const lines = stripFrontmatter(content).split("\n");
  const wanted = heading.trim().toLowerCase();
  let level = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m && m[2].trim().toLowerCase() === wanted) {
      level = m[1].length;
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

/**
 * Resolve a wikilink fragment against note content:
 * `^id` → block, anything else → heading section. Returns null when the
 * fragment doesn't match (callers show a fallback).
 */
export function sliceFragment(content: string, fragment: string): string | null {
  const f = fragment.trim();
  if (!f) return null;
  if (f.startsWith("^")) return sliceBlock(content, f.slice(1));
  return sliceHeading(content, f);
}

/** All `^block-id` markers present in a note (for autocomplete). */
export function listBlockIds(content: string): string[] {
  const ids: string[] = [];
  for (const line of stripFrontmatter(content).split("\n")) {
    const m = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (m) ids.push(m[1]);
  }
  return [...new Set(ids)];
}
