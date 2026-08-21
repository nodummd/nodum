import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Forum · Nodum",
  description: "The Nodum forum — announcements, help, bug reports, feature requests and showcases.",
};

/** The forum shell: site chrome plus the forum's own little nav.
 *  Public and server-rendered — a person (or crawler) reads it without an
 *  account; signing in lights up composing, likes and unread chips. */
export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <div className="mx-auto w-full max-w-5xl px-4 pt-10 pb-16 sm:px-6">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mk-eyebrow">Forum</p>
            <h1 className="mk-display text-[1.9rem] sm:text-[2.2rem]">
              <Link href="/forum">Talk Nodum</Link>
            </h1>
          </div>
          <nav className="flex items-center gap-2" aria-label="Community sections">
            <Link className="mk-navlink" href="/forum">
              Latest
            </Link>
            <Link className="mk-navlink" href="/forum?top=week">
              Top
            </Link>
            <Link className="mk-navlink" href="/forum/search">
              Search
            </Link>
            <Link className="mk-btn mk-btn--primary h-9 px-4 text-[0.875rem]" href="/forum/new">
              New topic
            </Link>
          </nav>
        </header>
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
