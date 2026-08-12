"use client";

/** Search pane — full-text search with highlighted snippets. */

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { searchApi } from "@/lib/api/endpoints";

export function SearchPane({
  vaultId,
  onOpenNote,
}: {
  vaultId: string;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();

  const { data, isFetching } = useQuery({
    queryKey: ["search", vaultId, trimmed],
    queryFn: () => searchApi.search(vaultId, trimmed),
    enabled: trimmed.length > 0,
    gcTime: 30_000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <div className="flex items-center gap-1.5 rounded-md border border-ob-border bg-ob-bg px-2">
          <Search className="size-3.5 shrink-0 text-ob-faint" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search… (path: file: tag:)"
            aria-label="Search notes"
            className="h-7 w-full bg-transparent text-[13px] text-ob-text outline-none placeholder:text-ob-faint"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {trimmed.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-ob-faint">
            Operators: <code className="text-ob-muted">path:</code>{" "}
            <code className="text-ob-muted">file:</code> <code className="text-ob-muted">tag:</code>{" "}
            <code className="text-ob-muted">&quot;phrase&quot;</code>{" "}
            <code className="text-ob-muted">-exclude</code>
          </p>
        ) : isFetching && !data ? (
          <p className="px-2 py-1 text-[13px] text-ob-faint">Searching…</p>
        ) : data && data.results.length === 0 ? (
          <p className="px-2 py-1 text-[13px] text-ob-faint">No results.</p>
        ) : (
          data?.results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenNote(r.id, r.title)}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-ob-hover"
            >
              <span className="block truncate text-[13px] font-medium text-ob-text">{r.title}</span>
              {r.path !== r.title && (
                <span className="block truncate text-[11px] text-ob-faint">{r.path}</span>
              )}
              <span
                className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ob-muted [&_mark]:rounded-xs [&_mark]:bg-ob-accent/30 [&_mark]:px-0.5 [&_mark]:text-ob-text"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet) }}
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Allow only the <mark> tags produced by ts_headline; escape everything else. */
function sanitizeSnippet(snippet: string): string {
  const escaped = snippet
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.replaceAll("&lt;mark&gt;", "<mark>").replaceAll("&lt;/mark&gt;", "</mark>");
}
