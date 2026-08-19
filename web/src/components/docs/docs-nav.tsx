"use client";

/**
 * The docs' left rail: articles grouped by section, filtered as you type —
 * by title, headings, summary and the article text itself, so "attachment
 * folder" finds the page that mentions it even if no heading does. A body-only
 * match shows the sentence it was found in under the row.
 * It is laid out like the app's own file explorer — the docs are a small
 * vault about the vault — with the current article as the "open" row.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

export interface DocsNavItem {
  slug: string;
  title: string;
  section: string;
  summary: string;
  headings: string[];
  /** Plain text of the article body. */
  text: string;
}

/** The words around the first occurrence of `q` in `text`, for the row. */
export function snippetAround(text: string, q: string, radius = 48): string | null {
  const lower = text.toLowerCase();
  const at = lower.indexOf(q);
  if (at < 0) return null;
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + q.length + radius);
  // Snap to word boundaries so the snippet never starts or ends mid-word.
  if (start > 0) start = text.lastIndexOf(" ", start) + 1 || start;
  if (end < text.length) {
    const space = text.indexOf(" ", end);
    if (space >= 0) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Why a row matched: the strongest of title › heading › summary › body. */
export function matchArticle(
  a: DocsNavItem,
  q: string,
): { rank: number; snippet: string | null } | null {
  if (a.title.toLowerCase().includes(q)) return { rank: 0, snippet: null };
  if (a.headings.some((h) => h.toLowerCase().includes(q))) return { rank: 1, snippet: null };
  if (a.summary.toLowerCase().includes(q)) return { rank: 2, snippet: null };
  const snippet = snippetAround(a.text, q);
  return snippet ? { rank: 3, snippet } : null;
}

export function DocsNav({ items, sections }: { items: DocsNavItem[]; sections: readonly string[] }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return items.map((a) => ({ article: a, snippet: null as string | null, rank: 0 }));
    return items
      .map((a) => {
        const m = matchArticle(a, q);
        return m ? { article: a, snippet: m.snippet, rank: m.rank } : null;
      })
      .filter((m): m is { article: DocsNavItem; snippet: string | null; rank: number } => m !== null)
      .sort((x, y) => x.rank - y.rank);
  }, [items, q]);

  return (
    <nav aria-label="Documentation" className="mk-docs-nav">
      <label className="mk-docs-search">
        <Search className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the docs…"
          aria-label="Search the documentation"
        />
      </label>
      {sections.map((section) => {
        const rows = visible.filter((m) => m.article.section === section);
        if (rows.length === 0) return null;
        return (
          <div key={section} className="mk-docs-section">
            <p className="mk-eyebrow">{section}</p>
            <ul>
              {rows.map(({ article: a, snippet }) => {
                const href = `/docs/${a.slug}`;
                const current = pathname === href;
                return (
                  <li key={a.slug}>
                    <Link href={href} aria-current={current ? "page" : undefined} className="mk-docs-row">
                      {a.title}
                    </Link>
                    {snippet && (
                      <p className="mk-docs-snippet" data-testid="docs-snippet">
                        {snippet}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {visible.length === 0 && (
        <p className="mk-docs-empty">Nothing matches “{query}”. Try a feature name — “graph”, “tags”, “MCP”.</p>
      )}
    </nav>
  );
}
