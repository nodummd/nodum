import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/seo/json-ld";
import {
  Breadcrumbs,
  Checklist,
  CtaBand,
  FaqList,
  RelatedLinks,
  Section,
  SeoHero,
} from "@/components/seo/page-parts";
import { ALTERNATIVES_BY_RANK } from "@/content/seo/alternatives";
import { TOPIC_SLUGS, getTopic } from "@/content/seo/topics";
import { pageMetadata } from "@/lib/seo/metadata";
import * as ld from "@/lib/seo/jsonld";

/**
 * The concept pages: /learn/second-brain, /learn/knowledge-graph, and so on.
 *
 * These sat at the top level first — /second-brain — which reads slightly
 * better and buys essentially nothing, because a keyword in a URL has been a
 * negligible ranking signal for years. What it *did* buy was a root-level
 * dynamic segment, and that turns out to be genuinely greedy: with `app/[x]`
 * present, `@next/next/no-html-link-for-pages` treats every internal `<a href>`
 * in the codebase as a page link and starts flagging deliberate full-page
 * navigations, like the one to the OAuth start endpoint. Silencing a lint rule
 * repo-wide to save one URL segment is a bad trade, so the pages live under a
 * prefix and the rule keeps working.
 *
 * `dynamicParams = false` makes anything outside the known list a plain 404
 * rather than a render that calls notFound().
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return TOPIC_SLUGS.map((topic) => ({ topic }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const topic = getTopic((await params).topic);
  if (!topic) return { title: "Not found" };
  return pageMetadata({
    title: topic.metaTitle,
    description: topic.description,
    path: `/learn/${topic.slug}`,
    keywords: topic.keywords,
    type: "article",
  });
}

export default async function TopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic: slug } = await params;
  const topic = getTopic(slug);
  if (!topic) notFound();

  const path = `/learn/${topic.slug}`;
  const trail = [
    { name: "Nodum", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: topic.eyebrow, path },
  ];

  // Every topic page points at the comparison cluster and vice versa: the two
  // halves of the site are about the same subject and should be seen to be.
  const comparisons = ALTERNATIVES_BY_RANK.slice(0, 3);

  return (
    <>
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path,
            name: topic.title,
            description: topic.description,
            breadcrumbId: ld.breadcrumbId(path),
          }),
          ld.breadcrumbs(trail),
          ld.article({
            path,
            headline: topic.title,
            description: topic.description,
            section: topic.eyebrow,
          }),
          ld.faqPage(path, topic.faqs),
        )}
      />

      <div className="mk-seo-page">
        <Breadcrumbs trail={trail} />

        <SeoHero eyebrow={topic.eyebrow} title={topic.title} answer={topic.answer} />

        {topic.sections.map((section) => (
          <Section
            key={section.heading}
            heading={section.heading}
            body={section.body}
            bullets={section.bullets}
          />
        ))}

        {topic.checklist && (
          <Checklist
            heading={topic.checklist.heading}
            intro={topic.checklist.intro}
            items={topic.checklist.items}
          />
        )}

        <FaqList faqs={topic.faqs} />

        <RelatedLinks links={topic.related} />

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">Comparing specific tools</h2>
          <ul className="mk-hub-grid">
            {comparisons.map((a) => (
              <li key={a.slug}>
                <Link href={`/alternatives/${a.slug}`} className="mk-hub-card">
                  <span className="mk-hub-name">Nodum vs {a.name}</span>
                  <span className="mk-hub-note">{a.description}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mk-hub-note mt-4">
            All {ALTERNATIVES_BY_RANK.length} are on the <Link href="/alternatives">alternatives index</Link>. Terms used
            on this page are defined in the <Link href="/glossary">glossary</Link>.
          </p>
        </section>

        <CtaBand />
      </div>
    </>
  );
}
