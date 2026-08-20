import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import {
  Breadcrumbs,
  CtaBand,
  FaqList,
  RelatedLinks,
  SeoHero,
  Section,
} from "@/components/seo/page-parts";
import { ALTERNATIVES_BY_RANK, CHECKED } from "@/content/seo/alternatives";
import { TOPICS_BY_RANK } from "@/content/seo/topics";
import { pageMetadata } from "@/lib/seo/metadata";
import * as ld from "@/lib/seo/jsonld";

const PATH = "/alternatives";

const TRAIL = [
  { name: "Nodum", path: "/" },
  { name: "Alternatives", path: PATH },
];

const ANSWER =
  "Nodum is a free, open-source, browser-based knowledge base, and it is a credible alternative to Obsidian, Notion, Roam, Evernote, Logseq and the rest of this category — for some people. These pages say which people, and are equally clear about who should stay where they are.";

const FAQS = [
  {
    question: "What is the best open-source alternative to Obsidian?",
    answer:
      "Logseq if you want a local-first outliner with block references, and Nodum if you want a browser-based document editor with the same wikilink syntax, automatic backlinks and a knowledge graph. Nodum is MIT licensed across frontend and backend, imports and exports Obsidian vaults as zips, and self-hosts with one Docker Compose command.",
  },
  {
    question: "How do these comparisons decide what is better?",
    answer:
      "They do not declare a winner. Each page lists what the other tool does better, what Nodum does better, who should switch and who should not, plus a structural facts table covering licence, storage format, link syntax, graph, pricing model and export path. Facts were last checked in August 2026.",
  },
  {
    question: "Can I import my notes from these apps into Nodum?",
    answer:
      "From anything that exports markdown, yes — Obsidian, Logseq, Notion, Joplin, Roam and most others. Zip the exported folder and import it from Settings → Vault → Import; Nodum resolves wikilinks across the whole batch. Evernote and OneNote need a conversion step first, which the relevant pages describe.",
  },
];

export const metadata: Metadata = pageMetadata({
  title: "Alternatives — an honest comparison with 18 note apps",
  description:
    "How Nodum compares to Obsidian, Notion, Logseq, Roam, Evernote and 13 more — including what each of them does better. Licence, storage, links, graph, export.",
  path: PATH,
  keywords: [
    "obsidian alternative",
    "notion alternative",
    "open source note taking app",
    "evernote alternative",
    "logseq alternative",
    "roam research alternative",
    "note app comparison",
  ],
});

export default function AlternativesHub() {
  const openSource = ALTERNATIVES_BY_RANK.filter((a) => !a.facts.license.startsWith("Proprietary"));
  const proprietary = ALTERNATIVES_BY_RANK.filter((a) => a.facts.license.startsWith("Proprietary"));

  return (
    <>
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path: PATH,
            name: "Nodum alternatives",
            description: metadata.description as string,
            breadcrumbId: ld.breadcrumbId(PATH),
            dateModified: CHECKED,
          }),
          ld.breadcrumbs(TRAIL),
          ld.itemList({
            path: PATH,
            name: "Note-taking apps compared with Nodum",
            description:
              `Comparisons between Nodum and ${ALTERNATIVES_BY_RANK.length} other note-taking and knowledge-management applications.`,
            items: ALTERNATIVES_BY_RANK.map((a) => ({
              name: `Nodum vs ${a.name}`,
              path: `/alternatives/${a.slug}`,
              description: a.description,
            })),
          }),
          ld.faqPage(PATH, FAQS),
        )}
      />

      <div className="mk-seo-page">
        <Breadcrumbs trail={TRAIL} />

        <SeoHero
          eyebrow="Alternatives"
          title={`Nodum compared with ${ALTERNATIVES_BY_RANK.length} other note apps`}
          answer={ANSWER}
          meta={`Structural facts last checked ${new Date(CHECKED).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}`}
        />

        <Section
          heading="How to read these pages"
          body={[
            "Comparison pages are usually adverts with a table in them. These try not to be. Every page opens with what the other tool is, fairly described, and then commits to four things: a list of what it does **better** than Nodum, a list of what Nodum does better, who should switch, and who should stay exactly where they are.",
            "The facts table on each page sticks to structural claims — licence, hosting model, storage format, link syntax, graph, pricing *model*, platforms and export path. Those are checkable and they do not rot the way a price does. Where a number would go stale in a month, you get the shape instead.",
          ]}
        />

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">Open-source tools</h2>
          <p className="mk-hub-note mt-2">
            Where the argument is about model and architecture rather than licence — because
            everything here, Nodum included, publishes its source.
          </p>
          <ul className="mk-hub-grid">
            {openSource.map((a) => (
              <li key={a.slug}>
                <Link href={`/alternatives/${a.slug}`} className="mk-hub-card">
                  <span className="mk-hub-name">Nodum vs {a.name}</span>
                  <span className="mk-hub-note">{a.description}</span>
                  <span className="mk-hub-tag">{a.facts.license.split("—")[0].trim()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">Proprietary tools</h2>
          <p className="mk-hub-note mt-2">
            Good software, closed source. The comparison is usually about what happens to your
            notes if the company changes its mind.
          </p>
          <ul className="mk-hub-grid">
            {proprietary.map((a) => (
              <li key={a.slug}>
                <Link href={`/alternatives/${a.slug}`} className="mk-hub-card">
                  <span className="mk-hub-name">Nodum vs {a.name}</span>
                  <span className="mk-hub-note">{a.description}</span>
                  <span className="mk-hub-tag">Proprietary</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <FaqList faqs={FAQS} />

        <RelatedLinks
          heading="Or start from the problem, not the product"
          links={TOPICS_BY_RANK.slice(0, 6).map((t) => ({
            label: t.title.split("—")[0].trim(),
            path: `/learn/${t.slug}`,
          }))}
        />

        <CtaBand
          title="Try it against your own vault."
          body="Import a zip, look at the graph, export it again. The whole evaluation takes ten minutes and costs nothing."
        />
      </div>
    </>
  );
}
