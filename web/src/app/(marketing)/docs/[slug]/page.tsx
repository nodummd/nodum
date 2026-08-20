import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Breadcrumbs } from "@/components/seo/page-parts";
import { JsonLd } from "@/components/seo/json-ld";
import { loadDoc, loadDocs } from "@/lib/docs";
import * as ld from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateStaticParams() {
  return (await loadDocs()).map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await loadDoc(slug);
  if (!doc) return { title: "Not found", robots: { index: false, follow: true } };
  return pageMetadata({
    title: doc.title,
    description: doc.summary,
    path: `/docs/${doc.slug}`,
    type: "article",
  });
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const docs = await loadDocs();
  const index = docs.findIndex((d) => d.slug === slug);
  if (index === -1) notFound();
  const doc = docs[index];
  const prev = docs[index - 1];
  const next = docs[index + 1];

  const path = `/docs/${doc.slug}`;
  const trail = [
    { name: "Nodum", path: "/" },
    { name: "Documentation", path: "/docs" },
    { name: doc.title, path },
  ];

  return (
    <article className="mk-docs-article">
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path,
            name: doc.title,
            description: doc.summary,
            breadcrumbId: ld.breadcrumbId(path),
          }),
          ld.breadcrumbs(trail),
          ld.article({
            path,
            headline: doc.title,
            description: doc.summary,
            section: doc.section,
          }),
        )}
      />
      <Breadcrumbs trail={trail} />
      <p className="mk-eyebrow mt-4">{doc.section}</p>
      <h1 className="mk-display text-[2rem] sm:text-[2.4rem]">{doc.title}</h1>
      <p className="mk-docs-lede">{doc.summary}</p>
      {doc.where && (
        <p className="mk-docs-where">
          <span className="mk-eyebrow">Where</span>
          <span>{doc.where}</span>
        </p>
      )}
      <div className="mk-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Screenshots are the point of these pages: give them room and a
            // frame, and never let one overflow the column.
            // A markdown image is inline inside a <p>; a <figure> may not be.
            // Unwrap the paragraph when its only child is an image, and let
            // the image render as its own block with a caption.
            p: ({ node, children, ...rest }) => {
              const only = node?.children?.length === 1 ? node.children[0] : null;
              if (only && only.type === "element" && only.tagName === "img") {
                const props = only.properties as { src?: string; alt?: string };
                return (
                  <figure className="mk-docs-figure">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={props.src ?? ""} alt={props.alt ?? ""} loading="lazy" />
                    {props.alt && <figcaption>{props.alt}</figcaption>}
                  </figure>
                );
              }
              return <p {...rest}>{children}</p>;
            },
            a: ({ href, children }) =>
              href?.startsWith("/") ? (
                <Link href={href}>{children}</Link>
              ) : (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
          }}
        >
          {doc.body}
        </ReactMarkdown>
      </div>
      <nav className="mk-docs-pager" aria-label="Neighbouring articles">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="mk-docs-pager-link">
            <span className="mk-eyebrow">Previous</span>
            <span>{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/docs/${next.slug}`} className="mk-docs-pager-link mk-docs-pager-link--next">
            <span className="mk-eyebrow">Next</span>
            <span>{next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
