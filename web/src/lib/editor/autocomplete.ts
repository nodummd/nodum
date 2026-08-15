/** Autocomplete sources: [[wikilinks]] from note titles, #tags from the vault. */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { noteApi, searchApi } from "@/lib/api/endpoints";
import { listBlockIds } from "@/lib/editor/block-slice";

async function fetchNoteContent(vaultId: string, target: string): Promise<string | null> {
  try {
    return (await noteApi.getByPath(vaultId, target)).content;
  } catch {
    const candidates = await searchApi.quickSwitch(vaultId, target, 3);
    const exact = candidates.find((c) => c.title.toLowerCase() === target.toLowerCase());
    if (!exact) return null;
    return (await noteApi.get(vaultId, exact.id)).content;
  }
}

/** Apply a completion inside `[[…]]`, closing the link exactly once.
 *
 *  closeBrackets auto-closes as soon as `[` is typed, so by the time a
 *  completion runs the document usually already reads `[[query]]` with the
 *  caret before the `]]`. Appending our own pair produced `[[target]]]]` —
 *  which then rendered as a broken link with two stray brackets beside it.
 *  Only close what is not already closed, and leave the caret after the link. */
function applyInsideLink(text: string) {
  return (view: EditorView, _completion: unknown, from: number, to: number) => {
    const alreadyClosed = view.state.sliceDoc(to, to + 2) === "]]";
    const insert = alreadyClosed ? text : `${text}]]`;
    const caret = from + insert.length + (alreadyClosed ? 2 : 0);
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: caret },
      userEvent: "input.complete",
    });
  };
}

export function wikiLinkCompletion(vaultId: string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // "[[Note#^blo" / "[[Note#Head" → block-id / heading completion
    const fragMatch = context.matchBefore(/\[\[([^\][\n#|]+)#(\^?[^\][\n#|]*)$/);
    if (fragMatch) {
      const inner = fragMatch.text.slice(2);
      const hash = inner.indexOf("#");
      const target = inner.slice(0, hash).trim();
      const frag = inner.slice(hash + 1);
      const content = await fetchNoteContent(vaultId, target);
      if (content === null) return null;

      const from = fragMatch.from + 2 + hash + 1;
      if (frag.startsWith("^")) {
        const query = frag.slice(1).toLowerCase();
        const options = listBlockIds(content)
          .filter((id) => !query || id.toLowerCase().startsWith(query))
          .slice(0, 12)
          .map((id) => ({ label: `^${id}`, type: "text", apply: applyInsideLink(`^${id}`) }));
        return options.length ? { from, options, filter: false } : null;
      }
      const query = frag.toLowerCase();
      const headings = [...content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1]);
      const options = [...new Set(headings)]
        .filter((h) => !query || h.toLowerCase().includes(query))
        .slice(0, 12)
        .map((h) => ({ label: h, type: "text", apply: applyInsideLink(h) }));
      return options.length ? { from, options, filter: false } : null;
    }

    // Match "[[query" backwards from the cursor (no closing ]])
    const match = context.matchBefore(/\[\[([^\][\n]*)$/);
    if (!match) return null;

    const query = match.text.slice(2);
    const results = await searchApi.quickSwitch(vaultId, query, 12);

    return {
      from: match.from + 2,
      options: results.map((r) => ({
        label: r.title,
        detail: r.path !== r.title ? r.path : undefined,
        type: "text",
        apply: applyInsideLink(r.path === r.title ? r.title : r.path),
      })),
      filter: false,
    };
  };
}

export function tagCompletion(vaultId: string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/(?:^|\s)#([\w/-]*)$/);
    if (!match) return null;

    const hashIndex = match.text.indexOf("#");
    const query = match.text.slice(hashIndex + 1).toLowerCase();
    const tags = await searchApi.tags(vaultId);
    const options = tags
      .filter((t) => !query || t.name.startsWith(query))
      .slice(0, 12)
      .map((t) => ({
        label: `#${t.name}`,
        detail: String(t.count),
        type: "keyword",
        apply: t.name,
      }));

    if (options.length === 0) return null;
    return { from: match.from + hashIndex + 1, options, filter: false };
  };
}
