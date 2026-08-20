import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import { DOC_SECTIONS, loadDocs } from "@/lib/docs";
import * as ld from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";

const PATH = "/docs";
const TRAIL = [
  { name: "Nodum", path: "/" },
  { name: "Documentation", path: PATH },
];

export const metadata: Metadata = pageMetadata({
  title: "Documentation",
  description:
    "What every part of Nodum is for — the explorer, the editor, links and the graph, search, vaults, AI and MCP — with an example and a screenshot for each.",
  path: PATH,
  keywords: [
    "nodum documentation",
    "nodum docs",
    "how to use nodum",
    "wikilinks",
    "knowledge graph",
    "markdown editor",
  ],
});

/** The front door: what the docs are, and every article by section. */
export default async function DocsIndex() {
  const docs = await loadDocs();
  return (
    <article className="mk-docs-article">
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path: PATH,
            name: "Nodum documentation",
            description: metadata.description as string,
            breadcrumbId: ld.breadcrumbId(PATH),
          }),
          ld.breadcrumbs(TRAIL),
          ld.itemList({
            path: PATH,
            name: "Nodum documentation",
            description: "Every part of Nodum, explained with an example and a screenshot.",
            items: docs.map((d) => ({
              name: d.title,
              path: `/docs/${d.slug}`,
              description: d.summary,
            })),
          }),
        )}
      />
      <p className="mk-eyebrow">Documentation</p>
      <h1 className="mk-display text-[2rem] sm:text-[2.6rem]">What every part of Nodum is for</h1>
      <p className="mk-docs-lede">
        Each page here answers the same three questions about one thing — a button, a panel, a
        shortcut: what it is, when you would use it, and what it looks like — with a screenshot
        taken from the real app. New here? Start with{" "}
        <Link href="/docs/getting-started">Getting started</Link>, or take the tour from the{" "}
        <span className="mk-kbd">?</span> in the app&apos;s ribbon.
      </p>
      {DOC_SECTIONS.map((section) => {
        const rows = docs.filter((d) => d.section === section);
        if (rows.length === 0) return null;
        return (
          <section key={section} className="mk-docs-index-section">
            <p className="mk-eyebrow">{section}</p>
            <ul className="mk-docs-index-list">
              {rows.map((d) => (
                <li key={d.slug}>
                  <Link href={`/docs/${d.slug}`} className="mk-docs-index-card">
                    <span className="mk-docs-index-title">{d.title}</span>
                    <span className="mk-docs-index-summary">{d.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </article>
  );
}
