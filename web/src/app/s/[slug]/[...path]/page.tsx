import type { Metadata } from "next";

import { JsonLd } from "@/components/seo/json-ld";
import { PublicReader } from "@/components/site/public-reader";
import { SiteFooterNote, SiteShell } from "@/components/site/site-shell";
import { excerpt, fetchPublicSite, fetchPublicSiteNote } from "@/lib/api/public-server";
import * as ld from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { absolute } from "@/lib/seo/site";

/**
 * One published note. Server-rendered: title, body and the whole note rail are
 * in the initial HTML, and the description is drawn from the note's own first
 * paragraph rather than a generic site blurb.
 */

function decodePath(parts: string[]): string {
  return parts.map(decodeURIComponent).join("/");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; path: string[] }>;
}): Promise<Metadata> {
  const { slug, path } = await params;
  const notePath = decodePath(path);
  const note = await fetchPublicSiteNote(slug, notePath);
  const url = `/s/${slug}/${path.join("/")}`;

  if (!note) {
    return pageMetadata({
      title: "Note not found",
      description: "This note is not part of the published site.",
      path: url,
      noindex: true,
    });
  }

  return pageMetadata({
    title: note.title,
    description: excerpt(note.content) || `${note.title} — a published note.`,
    path: url,
    type: "article",
    modifiedTime: note.updated_at,
  });
}

export default async function SiteNotePage({
  params,
}: {
  params: Promise<{ slug: string; path: string[] }>;
}) {
  const { slug, path } = await params;
  const notePath = decodePath(path);

  // One round trip each, in parallel: the note for the body, the site for the
  // rail and for resolving wikilinks between published notes.
  const [site, note] = await Promise.all([
    fetchPublicSite(slug),
    fetchPublicSiteNote(slug, notePath),
  ]);

  if (!site) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ob-bg text-ob-muted">
        <p>This site doesn&rsquo;t exist or is no longer published.</p>
      </main>
    );
  }

  const url = `/s/${slug}/${path.join("/")}`;

  return (
    <>
      {note && (
        <JsonLd
          data={ld.graph(
            ld.webPage({
              path: url,
              name: note.title,
              description: excerpt(note.content),
              dateModified: note.updated_at,
              breadcrumbId: ld.breadcrumbId(url),
            }),
            ld.breadcrumbs([
              { name: "Nodum", path: "/" },
              { name: site.vault_name, path: `/s/${slug}` },
              { name: note.title, path: url },
            ]),
            {
              "@type": "Article",
              "@id": `${absolute(url)}#article`,
              headline: note.title,
              description: excerpt(note.content),
              url: absolute(url),
              inLanguage: "en",
              dateModified: note.updated_at,
              mainEntityOfPage: { "@id": `${absolute(url)}#webpage` },
              isPartOf: { "@id": `${absolute(`/s/${slug}`)}#webpage` },
            },
          )}
        />
      )}
      <link rel="sitemap" type="application/xml" href={`/s/${slug}/sitemap.xml`} />

      <SiteShell site={site} activePath={notePath}>
        {note ? (
          <article>
            <h1 className="mb-6 text-[1.802em] leading-tight font-bold">{note.title}</h1>
            <PublicReader content={note.content} slug={slug} notes={site.notes} />
          </article>
        ) : (
          <p className="text-ob-muted">This note isn&rsquo;t part of the published site.</p>
        )}
        <SiteFooterNote />
      </SiteShell>
    </>
  );
}
