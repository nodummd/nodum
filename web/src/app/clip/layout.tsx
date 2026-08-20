import type { Metadata } from "next";

/**
 * The clipper hand-off page: a destination for the PWA share target, never a
 * landing page. `noindex` for the same reason as the workspace — robots.txt
 * stops the crawl, this stops the listing. The page is a client component and
 * cannot export metadata itself.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function ClipLayout({ children }: { children: React.ReactNode }) {
  return children;
}
