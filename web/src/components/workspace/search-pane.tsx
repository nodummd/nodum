"use client";

/** Search pane — full-text search with highlighted snippets. */

import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { searchApi } from "@/lib/api/endpoints";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function SearchPane({
  vaultId,
  onOpenNote,
}: {
  vaultId: string;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const searchSeed = useWorkspaceStore((s) => s.searchSeed);
  const [query, setQuery] = useState(searchSeed ?? "");
  const [debounced, setDebounced] = useState(searchSeed ?? "");
  // Render-time state adjustment when another panel seeds a query (tag click)
  const [lastSeed, setLastSeed] = useState(searchSeed);
  if (searchSeed !== lastSeed) {
    setLastSeed(searchSeed);
    if (searchSeed !== null) {
      setQuery(searchSeed);
      setDebounced(searchSeed);
    }
  }
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<"relevance" | "updated" | "created" | "title">("relevance");
  const [dateField, setDateField] = useState<"updated" | "created">("updated");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();

  // Compose the date filter into the operator syntax the backend understands
  let effectiveQuery = trimmed;
  if (dateFrom && dateTo) effectiveQuery += ` ${dateField}:${dateFrom}..${dateTo}`;
  else if (dateFrom) effectiveQuery += ` ${dateField}:>=${dateFrom}`;
  else if (dateTo) effectiveQuery += ` ${dateField}:<=${dateTo}`;
  effectiveQuery = effectiveQuery.trim();

  const { data, isFetching } = useQuery({
    queryKey: ["search", vaultId, effectiveQuery, sort],
    queryFn: () => searchApi.search(vaultId, effectiveQuery, sort),
    enabled: effectiveQuery.length > 0,
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
          <button
            type="button"
            aria-label="Search filters"
            aria-pressed={showFilters}
            onClick={() => setShowFilters((v) => !v)}
            className={
              showFilters
                ? "flex size-5 shrink-0 items-center justify-center rounded text-ob-accent"
                : "flex size-5 shrink-0 items-center justify-center rounded text-ob-faint hover:text-ob-text"
            }
          >
            <SlidersHorizontal className="size-3.5" strokeWidth={2} />
          </button>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-2 rounded-md border border-ob-border bg-ob-bg p-2">
            <label className="flex items-center justify-between gap-2 text-[12px] text-ob-muted">
              Sort by
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Sort results"
                className="rounded border border-ob-border bg-ob-sidebar px-1.5 py-0.5 text-[12px] text-ob-text outline-none"
              >
                <option value="relevance">Relevance</option>
                <option value="updated">Modified (newest)</option>
                <option value="created">Created (newest)</option>
                <option value="title">Title (A–Z)</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-[12px] text-ob-muted">
              Date field
              <select
                value={dateField}
                onChange={(e) => setDateField(e.target.value as typeof dateField)}
                aria-label="Date field"
                className="rounded border border-ob-border bg-ob-sidebar px-1.5 py-0.5 text-[12px] text-ob-text outline-none"
              >
                <option value="updated">Modified</option>
                <option value="created">Created</option>
              </select>
            </label>
            <div className="flex items-center gap-1.5 text-[12px] text-ob-muted">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
                className="min-w-0 flex-1 rounded border border-ob-border bg-ob-sidebar px-1.5 py-0.5 text-[12px] text-ob-text outline-none"
              />
              <span className="text-ob-faint">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
                className="min-w-0 flex-1 rounded border border-ob-border bg-ob-sidebar px-1.5 py-0.5 text-[12px] text-ob-text outline-none"
              />
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {trimmed.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-ob-faint">
            Operators: <code className="text-ob-muted">path:</code>{" "}
            <code className="text-ob-muted">file:</code> <code className="text-ob-muted">tag:</code>{" "}
            <code className="text-ob-muted">created:2026-08-01..2026-08-12</code>{" "}
            <code className="text-ob-muted">updated:&gt;2026-08-01</code>{" "}
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
              <span className="mt-0.5 block text-[10px] text-ob-faint">
                Modified {new Date(r.updated_at).toLocaleDateString()}
              </span>
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
