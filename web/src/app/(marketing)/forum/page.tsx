import type { Metadata } from "next";
import Link from "next/link";

import { ListEngagement } from "@/components/forum/engagement";

import { getCategories, getTopics } from "@/lib/api/forum-server";
import { pageMetadata } from "@/lib/seo/metadata";

import { Pager, TopicRow } from "./topic-row";

const PAGE_SIZE = 30;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; top?: string }>;
}): Promise<Metadata> {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  return pageMetadata({
    title: page > 1 ? `Forum — page ${page}` : "Forum — help, ideas and showcases",
    description:
      "The Nodum forum: ask for help, report bugs, vote on feature requests and share how you use Nodum, the open-source Obsidian alternative for the browser.",
    // Top views are re-sorts of the same topics, so they canonicalize to
    // Latest; later pages of Latest are distinct content and keep their own.
    path: page > 1 ? `/forum?page=${page}` : "/forum",
  });
}

/** The forum's front page: the category rail and Latest (or Top) topics. */
export default async function CommunityIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; top?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const top = params.top && ["week", "month", "all"].includes(params.top) ? params.top : undefined;
  const [categories, topics] = await Promise.all([
    getCategories(),
    getTopics({ top, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  return (
    <div className="grid gap-10 md:grid-cols-[240px_1fr]">
      <aside aria-label="Categories">
        <h2 className="mk-eyebrow mb-3">Categories</h2>
        <ul className="space-y-2">
          {(categories ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/forum/c/${c.slug}`} className="mk-card block px-3 py-2 hover:opacity-90">
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-[0.78rem] tabular-nums opacity-60">{c.topic_count}</span>
                {c.description && <p className="mt-0.5 text-[0.8rem] opacity-60">{c.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section aria-label={top ? "Top topics" : "Latest topics"}>
        <h2 className="mk-eyebrow mb-1">{top ? `Top · ${top}` : "Latest"}</h2>
        {topics && topics.items.length > 0 ? (
          <>
            <ListEngagement query={`${top ? `top=${top}&` : ""}limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`}>
              <ul>
                {topics.items.map((t) => (
                  <TopicRow key={t.id} topic={t} />
                ))}
              </ul>
            </ListEngagement>
            <Pager
              base={top ? `/forum?top=${top}` : "/forum"}
              page={page}
              hasPrev={page > 1}
              hasNext={page * PAGE_SIZE < topics.total}
            />
          </>
        ) : (
          <p className="mk-card px-4 py-6 opacity-70">
            Nothing here yet — <Link href="/forum/new" className="underline">start the first topic</Link>.
          </p>
        )}
      </section>
    </div>
  );
}
