import type { Metadata } from "next";

/**
 * The workspace is never a search result.
 *
 * robots.txt already disallows `/vault`, but a disallowed URL can still be
 * indexed URL-only if something links to it — the rule stops the crawl, not
 * the listing. A `noindex` on the page itself is the directive that actually
 * removes it, and this layout is the only place to put one: the vault pages
 * are client components, which cannot export metadata.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return children;
}
