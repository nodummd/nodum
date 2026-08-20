import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import { SiteFooterNote, SiteShell } from "@/components/site/site-shell";
import { fetchPublicSite } from "@/lib/api/public-server";
import * as ld from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { SITE_NAME, absolute } from "@/lib/seo/site";

/**
 * A published vault's front page — server-rendered, so the vault name and
 * every published note title are in the initial HTML.
 *
 * These pages are indexable on purpose. Publishing a vault as a site is an
 * explicit action a user takes meaning "this is public"; the unlisted
 * per-note links under `/p/` are the other case, and those are noindex.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await fetchPublicSite(slug);
  if (!site) {
    return pageMetadata({
      title: "Site not found",
      description: "This published site does not exist or is no longer public.",
      path: `/s/${slug}`,
      noindex: true,
    });
  }
  return pageMetadata({
    title: site.vault_name,
    description: `${site.vault_name} — a published Nodum vault of ${site.notes.length} linked notes.`,
    path: `/s/${slug}`,
  });
}

export default async function SiteIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await fetchPublicSite(slug);

  if (!site) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ob-bg text-ob-muted">
        <p>This site doesn&rsquo;t exist or is no longer published.</p>
      </main>
    );
  }

  const path = `/s/${slug}`;

  return (
    <>
      {/* A published vault is a small site of its own: declare it as a
          Collection so the notes are understood as its parts. */}
      <JsonLd
        data={ld.graph(
          {
            "@type": "CollectionPage",
            "@id": `${absolute(path)}#webpage`,
            url: absolute(path),
            name: site.vault_name,
            description: `A published Nodum vault of ${site.notes.length} linked notes.`,
            inLanguage: "en",
            isPartOf: { "@id": `${absolute("/")}#website` },
            publisher: { "@id": `${absolute("/")}#organization` },
          },
          ld.itemList({
            path,
            name: `${site.vault_name} — notes`,
            description: `Published notes in ${site.vault_name}.`,
            items: site.notes.map((n) => ({
              name: n.title,
              path: `/s/${slug}/${n.path.split("/").map(encodeURIComponent).join("/")}`,
            })),
          }),
        )}
      />
      {/* The site's own sitemap, so a crawler that lands on any page of a
          large published vault can enumerate the rest in one request. */}
      <link rel="sitemap" type="application/xml" href={`${path}/sitemap.xml`} />

      <SiteShell site={site} activePath={null}>
        <h1 className="mb-2 text-[1.802em] font-bold">{site.vault_name}</h1>
        <p className="mb-6 text-[13px] text-ob-faint">
          A published {SITE_NAME} vault · {site.notes.length}{" "}
          {site.notes.length === 1 ? "note" : "notes"}
        </p>
        <ul className="space-y-1">
          {site.notes.map((n) => (
            <li key={n.path}>
              <Link
                href={`/s/${slug}/${n.path.split("/").map(encodeURIComponent).join("/")}`}
                className="text-ob-accent hover:underline"
              >
                {n.title}
              </Link>
            </li>
          ))}
        </ul>
        <SiteFooterNote />
      </SiteShell>
    </>
  );
}
