import type { MetadataRoute } from "next";

import { ALTERNATIVES, CHECKED } from "@/content/seo/alternatives";
import { TOPICS } from "@/content/seo/topics";
import { getCategories, getTopics, type CommunityTopicItem } from "@/lib/api/forum-server";
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
 * Section pages (docs, forum, community, API reference) are listed at the URL
 * they are served from: `absolute()` resolves them to their subdomain when
 * subdomains are on, so no entry here is a redirect.
 *
 * Forum categories and threads are included, with the thread's last reply as
 * its lastmod — the one place on the site where that date is both real and
 * changing. The API is unreachable while the image builds, so the build-time
 * sitemap has none; `revalidate` regenerates it hourly at run time.
 *
 * Published user sites under `/s/` are not enumerated here: there is no public
 * "list every published site" endpoint and adding one would change what a user
 * agreed to when they published. Each published site instead serves its own
 * sitemap at `/s/{slug}/sitemap.xml`, linked from its pages.
 */
export const revalidate = 3600;

/** The API caps a page at 100; stop well inside the 50,000-URL file limit. */
const FORUM_PAGE = 100;
const FORUM_MAX = 20_000;

async function allForumTopics(): Promise<CommunityTopicItem[]> {
  const topics: CommunityTopicItem[] = [];
  for (let offset = 0; offset < FORUM_MAX; offset += FORUM_PAGE) {
    const page = await getTopics({ limit: FORUM_PAGE, offset, revalidate });
    if (!page) break;
    topics.push(...page.items);
    if (page.items.length < FORUM_PAGE || offset + FORUM_PAGE >= page.total) break;
  }
  return topics;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [docs, categories, forumTopics] = await Promise.all([loadDocs(), getCategories(revalidate), allForumTopics()]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absolute("/"), changeFrequency: "weekly", priority: 1 },
    { url: absolute("/alternatives"), changeFrequency: "monthly", priority: 0.9, lastModified: CHECKED },
    { url: absolute("/learn"), changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/glossary"), changeFrequency: "monthly", priority: 0.7 },
    { url: absolute("/faq"), changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/docs"), changeFrequency: "weekly", priority: 0.8 },
    { url: absolute("/community"), changeFrequency: "weekly", priority: 0.7 },
    { url: absolute("/forum"), changeFrequency: "daily", priority: 0.7 },
    // Auth pages are indexable but low value — they exist in the sitemap so a
    // crawler understands they are intentional rather than orphaned.
    // Low priority as pages, but they must be crawlable: Google's OAuth review
    // checks that the privacy policy is publicly reachable on the app's domain.
    { url: absolute("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: absolute("/terms"), changeFrequency: "yearly", priority: 0.3 },
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

  const categoryRoutes: MetadataRoute.Sitemap = (categories ?? []).map((category) => ({
    url: absolute(`/forum/c/${category.slug}`),
    changeFrequency: "daily",
    priority: 0.5,
  }));

  // Pinned topics float to the top of Latest, so the same thread can appear
  // on more than one page of the listing.
  const seen = new Set<string>();
  const threadRoutes: MetadataRoute.Sitemap = forumTopics
    .filter((topic) => !seen.has(topic.id) && seen.add(topic.id))
    .map((topic) => ({
      url: absolute(`/forum/t/${topic.id}/${topic.slug}`),
      lastModified: topic.last_post_at,
      changeFrequency: "weekly",
      priority: 0.5,
    }));

  return [
    ...staticRoutes,
    ...topicRoutes,
    ...alternativeRoutes,
    ...docRoutes,
    ...categoryRoutes,
    ...threadRoutes,
  ];
}
