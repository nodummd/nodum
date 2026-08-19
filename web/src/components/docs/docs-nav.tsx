"use client";

/**
 * The docs' left rail: articles grouped by section, filtered as you type.
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
}

export function DocsNav({ items, sections }: { items: DocsNavItem[]; sections: readonly string[] }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.headings.some((h) => h.toLowerCase().includes(q)),
    );
  }, [items, query]);

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
        const rows = visible.filter((a) => a.section === section);
        if (rows.length === 0) return null;
        return (
          <div key={section} className="mk-docs-section">
            <p className="mk-eyebrow">{section}</p>
            <ul>
              {rows.map((a) => {
                const href = `/docs/${a.slug}`;
                const current = pathname === href;
                return (
                  <li key={a.slug}>
                    <Link href={href} aria-current={current ? "page" : undefined} className="mk-docs-row">
                      {a.title}
                    </Link>
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
