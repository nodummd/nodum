import { fetchPublicSite } from "@/lib/api/public-server";
import { absolute } from "@/lib/seo/site";

/**
 * A per-site sitemap for a published vault, at /s/{slug}/sitemap.xml.
 *
 * The root sitemap deliberately does not enumerate published sites: there is
 * no public "list every published vault" endpoint, and adding one would widen
 * what a user agreed to when they pressed publish — a slug they shared with
 * forty colleagues is not the same as a slug in a global directory.
 *
 * This gets the crawl coverage without that change. Each published site
 * advertises its own sitemap from a `<link rel="sitemap">` on its pages, so a
 * crawler that reaches one note of a 500-note vault can enumerate the rest in
 * a single request instead of walking the nav.
 *
 * Written as a route handler rather than a `sitemap.ts` metadata file because
 * the slug is not known at build time and there is nothing to enumerate it
 * from — a route handler serves any slug on demand.
 */

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const site = await fetchPublicSite(slug);

  if (!site) {
    return new Response("Not found", { status: 404 });
  }

  const urls = [
    absolute(`/s/${slug}`),
    ...site.notes.map((n) =>
      absolute(`/s/${slug}/${n.path.split("/").map(encodeURIComponent).join("/")}`),
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n")}
</urlset>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // A minute, and no shared-cache extension. This document lists note
      // titles, so an unpublished site should stop being described quickly —
      // the same reasoning that makes the page fetches `no-store`.
      "Cache-Control": "public, max-age=60",
    },
  });
}
