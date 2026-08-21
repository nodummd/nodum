import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCategories, getTopics } from "@/lib/api/community-server";

import { Pager, TopicRow } from "../../topic-row";

const PAGE_SIZE = 30;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = (await getCategories())?.find((c) => c.slug === slug);
  if (!category) return {};
  return {
    title: `${category.name} · Nodum Community`,
    description: category.description ?? `${category.name} — the Nodum community.`,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [categories, topics] = await Promise.all([
    getCategories(),
    getTopics({ category: slug, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  const category = categories?.find((c) => c.slug === slug);
  if (!category || !topics) notFound();

  return (
    <section>
      <p className="mb-1">
        <Link href="/community" className="mk-navlink px-0">
          ← All categories
        </Link>
      </p>
      <h2 className="mk-display text-[1.5rem]">{category.name}</h2>
      {category.description && <p className="mb-4 opacity-70">{category.description}</p>}
      {topics.items.length > 0 ? (
        <>
          <ul>
            {topics.items.map((t) => (
              <TopicRow key={t.id} topic={t} showCategory={false} />
            ))}
          </ul>
          <Pager
            base={`/community/c/${slug}`}
            page={page}
            hasPrev={page > 1}
            hasNext={page * PAGE_SIZE < topics.total}
          />
        </>
      ) : (
        <p className="mk-card px-4 py-6 opacity-70">No topics here yet.</p>
      )}
    </section>
  );
}
