import type { MetadataRoute } from "next";

import { ALTERNATIVES, CHECKED } from "@/content/seo/alternatives";
import { TOPICS } from "@/content/seo/topics";
import { loadDocs } from "@/lib/docs";
import { absolute } from "@/lib/seo/site";

/**
 * sitemap.xml, generated from the content model rather than maintained by hand
 * — a hand-written sitemap is a file someone forgets, and a stale sitemap is
 * worse than none.
 *
 * Two deliberate choices:
 *
 * `lastModified` is set only where there is a real date behind it. The
 * comparison and topic pages carry `CHECKED`, the date their facts were last
 * verified. Docs and the static pages carry none, because the only date
 * available for them is "whenever this built", and Google discards a lastmod
 * that is always today — a sitemap that lies about freshness gets its
 * freshness signal ignored entirely.
 *
 * `priority` is relative within this site only. It says nothing to Google about
 * ranking; it says which pages to crawl first when the budget is tight. The
 * front door and the comparison cluster lead, because those are the pages an
 * answer engine is most likely to be asked to produce.
 *
 * Published user sites under `/s/` are not enumerated here: there is no public
 * "list every published site" endpoint and adding one would change what a user
 * agreed to when they published. Each published site instead serves its own
 * sitemap at `/s/{slug}/sitemap.xml`, linked from its pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await loadDocs();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absolute("/"), changeFrequency: "weekly", priority: 1 },
    { url: absolute("/alternatives"), changeFrequency: "monthly", priority: 0.9, lastModified: CHECKED },
    { url: absolute("/learn"), changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/glossary"), changeFrequency: "monthly", priority: 0.7 },
    { url: absolute("/faq"), changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/docs"), changeFrequency: "weekly", priority: 0.8 },
    // Auth pages are indexable but low value — they exist in the sitemap so a
    // crawler understands they are intentional rather than orphaned.
    { url: absolute("/login"), changeFrequency: "yearly", priority: 0.3 },
    { url: absolute("/signup"), changeFrequency: "yearly", priority: 0.4 },
  ];

  const topicRoutes: MetadataRoute.Sitemap = TOPICS.map((topic) => ({
    url: absolute(`/learn/${topic.slug}`),
    changeFrequency: "monthly",
    // The first few topics are the head terms for the whole category.
    priority: topic.rank <= 3 ? 0.9 : 0.7,
  }));

  const alternativeRoutes: MetadataRoute.Sitemap = ALTERNATIVES.map((alt) => ({
    url: absolute(`/alternatives/${alt.slug}`),
    lastModified: CHECKED,
    changeFrequency: "monthly",
    priority: alt.rank === 1 ? 0.9 : alt.rank <= 5 ? 0.8 : 0.6,
  }));

  const docRoutes: MetadataRoute.Sitemap = docs.map((doc) => ({
    url: absolute(`/docs/${doc.slug}`),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...topicRoutes, ...alternativeRoutes, ...docRoutes];
}
