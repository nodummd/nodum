/** Autocomplete sources: [[wikilinks]] from note titles, #tags from the vault. */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { searchApi } from "@/lib/api/endpoints";

export function wikiLinkCompletion(vaultId: string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
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
        apply: `${r.path === r.title ? r.title : r.path}]]`,
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
