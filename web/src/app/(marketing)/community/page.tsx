import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { getTopics } from "@/lib/api/forum-server";
import { GITHUB_URL as GITHUB } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: "Community · Nodum",
  description:
    "The Nodum community — where to ask, report, request and show off; how to contribute; and how to extend Nodum today.",
};

/** The community hub: a router with one live element, not a portal.
 *  Everything here is either a real link or a real topic — no invented
 *  member counts, no empty directory. Plugins get one honest teaser. */

const FORUM_CARDS = [
  { slug: "announcements", name: "Announcements", role: "News about Nodum — releases, changes, plans." },
  { slug: "help", name: "Help", role: "Stuck? Check the docs first, then ask here." },
  { slug: "bugs", name: "Bug Reports", role: "Something broken — search before filing." },
  { slug: "features", name: "Feature Requests", role: "Hearts are votes: like the opening post." },
  { slug: "showcase", name: "Showcase", role: "Vaults, workflows, integrations — show how you use Nodum." },
];

const EXTEND_TODAY = [
  { href: "/docs/api", title: "The public API", blurb: "Scoped keys, plain REST — drive vaults from any language." },
  { href: "/docs/mcp", title: "MCP", blurb: "Point Claude, Cursor or any MCP client at your vault." },
  { href: "/docs/clipper", title: "Web Clipper", blurb: "Capture pages into your vault from the browser." },
];

export const revalidate = 60;

export default async function CommunityHub() {
  const [showcase, announcements] = await Promise.all([
    getTopics({ category: "showcase", limit: 3 }),
    getTopics({ category: "announcements", limit: 3 }),
  ]);
  const strip = [...(announcements?.items ?? []), ...(showcase?.items ?? [])]
    .sort((a, b) => (a.last_post_at < b.last_post_at ? 1 : -1))
    .slice(0, 6);

  return (
    <>
      <SiteNav />
      <div className="mx-auto w-full max-w-5xl px-4 pt-12 pb-16 sm:px-6">
        <header className="mb-10">
          <p className="mk-eyebrow">Community</p>
          <h1 className="mk-display text-[2rem] sm:text-[2.4rem]">Built in the open</h1>
          <p className="mt-2 max-w-2xl opacity-75">
            The roadmap, the code and the conversation are all public. This page is the map: where to
            ask, where to report, where to show off — and how to make Nodum yours.
          </p>
        </header>

        <section aria-label="The forum" className="mb-12">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="mk-eyebrow">The forum</h2>
            <Link href="/forum" className="mk-navlink">
              forum home →
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FORUM_CARDS.map((c) => (
              <li key={c.slug}>
                <Link href={`/forum/c/${c.slug}`} className="mk-card block h-full px-4 py-3 hover:opacity-90">
                  <span className="font-medium">{c.name}</span>
                  <p className="mt-1 text-[0.85rem] opacity-65">{c.role}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {strip.length > 0 && (
          <section aria-label="From the community" className="mb-12">
            <h2 className="mk-eyebrow mb-3">From the community</h2>
            <ul className="space-y-2">
              {strip.map((t) => (
                <li key={t.id} className="flex items-baseline gap-3">
                  <span className="mk-eyebrow shrink-0">{t.category_slug}</span>
                  <Link href={`/forum/t/${t.id}/${t.slug}`} className="min-w-0 truncate hover:underline">
                    {t.title}
                  </Link>
                  <span className="ml-auto shrink-0 text-[0.8rem] tabular-nums opacity-60">
                    {t.reply_count} ↩
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Contribute" className="mb-12">
          <h2 className="mk-eyebrow mb-3">Contribute</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <a href={GITHUB} target="_blank" rel="noreferrer" className="mk-card block px-4 py-3 hover:opacity-90">
              <span className="font-medium">The code</span>
              <p className="mt-1 text-[0.85rem] opacity-65">
                Nodum is open source — if something bugs you, you can fix it. Issues and pull requests
                welcome.
              </p>
            </a>
            <a
              href={`${GITHUB}/blob/main/tasks/nodum-master-plan.md`}
              target="_blank"
              rel="noreferrer"
              className="mk-card block px-4 py-3 hover:opacity-90"
            >
              <span className="font-medium">The plan</span>
              <p className="mt-1 text-[0.85rem] opacity-65">
                The living master plan: what shipped, what is next, and why — updated with every
                release.
              </p>
            </a>
          </div>
        </section>

        <section aria-label="Extend Nodum">
          <h2 className="mk-eyebrow mb-3">Extend Nodum</h2>
          <ul className="mb-4 grid gap-3 sm:grid-cols-3">
            {EXTEND_TODAY.map((x) => (
              <li key={x.href}>
                <Link href={x.href} className="mk-card block h-full px-4 py-3 hover:opacity-90">
                  <span className="font-medium">{x.title}</span>
                  <p className="mt-1 text-[0.85rem] opacity-65">{x.blurb}</p>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mk-card px-4 py-3 text-[0.9rem] opacity-80">
            <span className="mk-eyebrow mr-2">Coming</span>
            Community plugins and themes are on the roadmap, and the API design will happen in the
            open. Want to build for Nodum?{" "}
            <Link href="/forum/c/features" className="underline">
              Tell us what you would make
            </Link>
            .
          </p>
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
