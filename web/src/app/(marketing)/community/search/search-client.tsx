"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api/client";

interface Hit {
  topic_id: string;
  topic_title: string;
  topic_slug: string;
  post_number: number;
  snippet: string;
}

/** ts_headline snippets carry real <mark> tags around matches and nothing
 *  else trustworthy — escape everything, then re-admit only the literal
 *  mark tags (the search-pane recipe). */
function sanitizeSnippet(snippet: string): string {
  const escaped = snippet.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped.replaceAll("&lt;mark&gt;", "<mark>").replaceAll("&lt;/mark&gt;", "</mark>");
}

export function SearchClient() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // All state changes happen inside the debounce tick — never synchronously
    // in the effect body (cascading-render lint, and it is just as correct).
    const query = q.trim();
    const t = setTimeout(() => {
      if (query.length < 2) {
        setHits(null);
        setBusy(false);
        return;
      }
      setBusy(true);
      void api<{ items: Hit[]; total: number }>(`/community/search?q=${encodeURIComponent(query)}&limit=25`)
        .then((data) => {
          setHits(data.items);
          setTotal(data.total);
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="mk-display mb-4 text-[1.5rem]">Search the community</h2>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Words, phrases, -exclusions…"
        aria-label="Search the community"
        className="mk-card w-full px-4 py-3"
      />
      {busy && <p className="mt-4 opacity-60">Searching…</p>}
      {hits !== null && !busy && (
        <>
          <p className="mt-4 text-[0.85rem] opacity-60">
            {total} result{total === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 space-y-4">
            {hits.map((h) => (
              <li key={`${h.topic_id}-${h.post_number}`} className="mk-card px-4 py-3">
                <Link
                  href={`/community/t/${h.topic_id}/${h.topic_slug}${h.post_number > 1 ? `#post-${h.post_number}` : ""}`}
                  className="font-medium hover:underline"
                >
                  {h.topic_title}
                  {h.post_number > 1 && <span className="ml-2 text-[0.8rem] opacity-60">#{h.post_number}</span>}
                </Link>
                <p
                  className="mt-1 text-[0.85rem] opacity-80 [&_mark]:rounded-sm [&_mark]:bg-[var(--mk-accent,#7c6cf6)]/30 [&_mark]:px-0.5 [&_mark]:text-inherit"
                  dangerouslySetInnerHTML={{ __html: sanitizeSnippet(h.snippet) }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
