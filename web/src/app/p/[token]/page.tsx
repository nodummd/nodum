import type { Metadata } from "next";
import Link from "next/link";

import { PublicReader } from "@/components/site/public-reader";
import { excerpt, fetchPublicNote } from "@/lib/api/public-server";
import { pageMetadata } from "@/lib/seo/metadata";

/**
 * A note published as an unlisted link. The token is the capability.
 *
 * Server-rendered but `noindex, follow`, and that pairing is the whole point.
 * Server rendering is what makes the link produce a real preview card when
 * someone pastes it into Slack, iMessage or a chat — those unfurlers read the
 * initial HTML and do not run JavaScript, so the old client-fetched version
 * previewed as an empty page.
 *
 * `noindex` is what keeps it out of search. A person clicking "publish note"
 * is sharing with recipients, not asking to be crawled; a vault published as a
 * whole site under `/s/` is the case where the intent *is* publication, and
 * those pages are indexable. `follow` is kept so the links out of the page
 * still count.
 *
 * `/p/` is also excluded in robots.txt for every agent, so in practice this
 * meta tag is the second of two locks.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const note = await fetchPublicNote(token);
  return pageMetadata({
    title: note ? note.title : "Page not found",
    description: note
      ? excerpt(note.content) || `${note.title} — a note published with Nodum.`
      : "This note doesn't exist or was unpublished.",
    path: `/p/${token}`,
    type: "article",
    modifiedTime: note?.updated_at,
    publishedTime: note?.published_at,
    noindex: true,
  });
}

export default async function PublicNotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const note = await fetchPublicNote(token);

  return (
    <main className="min-h-screen bg-ob-bg text-ob-text">
      <header className="border-b border-ob-border">
        <div className="mx-auto flex max-w-[44rem] items-center justify-between px-6 py-3">
          <Link href="/" className="text-[13px] font-semibold tracking-tight">
            nodum
          </Link>
          <Link href="/signup" className="text-[12px] text-ob-accent hover:underline">
            Create your own vault →
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-[44rem] px-6 py-10">
        {note ? (
          <>
            <h1 className="mb-1 text-[1.802em] leading-tight font-bold">{note.title}</h1>
            <p className="mb-6 text-[12px] text-ob-faint">
              Published <time dateTime={note.published_at}>{formatDate(note.published_at)}</time> ·
              Updated <time dateTime={note.updated_at}>{formatDate(note.updated_at)}</time>
            </p>
            {/* No sibling notes on a token link: wikilinks render inert. */}
            <PublicReader content={note.content} slug={null} notes={[]} />
          </>
        ) : (
          <div className="py-20 text-center">
            <h1 className="text-xl font-bold">Page not found</h1>
            <p className="mt-2 text-[14px] text-ob-muted">
              This note doesn&rsquo;t exist or was unpublished.
            </p>
          </div>
        )}
      </article>
    </main>
  );
}

/** Fixed locale: the server renders this once and every reader sees the same
 *  string, so a locale-dependent format would mismatch on hydration. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
