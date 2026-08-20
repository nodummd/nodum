import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import {
  Breadcrumbs,
  CtaBand,
  FaqList,
  RelatedLinks,
  Section,
  SeoHero,
} from "@/components/seo/page-parts";
import { ALTERNATIVES } from "@/content/seo/alternatives";
import { GLOSSARY } from "@/content/seo/glossary";
import { TOPICS_BY_RANK } from "@/content/seo/topics";
import { pageMetadata } from "@/lib/seo/metadata";
import * as ld from "@/lib/seo/jsonld";

const PATH = "/learn";
const TRAIL = [
  { name: "Nodum", path: "/" },
  { name: "Learn", path: PATH },
];

const FAQS = [
  {
    question: "Where should I start with personal knowledge management?",
    answer:
      "Start by writing notes, not by designing a system. Pick a tool with cheap linking and a real export, title each note as the claim it makes, and link notes together as you notice connections. Structure emerges from the links after a few hundred notes; a hierarchy designed on day one almost never survives.",
  },
  {
    question: "What is the difference between a second brain and a Zettelkasten?",
    answer:
      "A Zettelkasten is one specific method for building a second brain: atomic notes written in your own words and linked to each other rather than filed by topic. Second brain is the broader term and covers methods like PARA that organise by actionability instead. Both depend on linking being cheap.",
  },
];

export const metadata: Metadata = pageMetadata({
  title: "Learn — second brains, Zettelkasten and knowledge graphs",
  description:
    "Guides to the ideas behind linked note-taking: second brains, Zettelkasten, PKM, knowledge graphs, backlinks, markdown and self-hosting. Tool-agnostic, no fluff.",
  path: PATH,
  keywords: [
    "second brain",
    "zettelkasten",
    "personal knowledge management",
    "knowledge graph",
    "note taking guide",
    "pkm guide",
    "backlinks",
  ],
});

export default function LearnHub() {
  return (
    <>
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path: PATH,
            name: "Learn",
            description: metadata.description as string,
            breadcrumbId: ld.breadcrumbId(PATH),
          }),
          ld.breadcrumbs(TRAIL),
          ld.itemList({
            path: PATH,
            name: "Guides to linked note-taking",
            description:
              "Explanations of second brains, Zettelkasten, knowledge graphs, backlinks and the rest of the ideas behind linked note-taking.",
            items: TOPICS_BY_RANK.map((t) => ({
              name: t.title,
              path: `/learn/${t.slug}`,
              description: t.description,
            })),
          }),
          ld.faqPage(PATH, FAQS),
        )}
      />

      <div className="mk-seo-page">
        <Breadcrumbs trail={TRAIL} />

        <SeoHero
          eyebrow="Learn"
          title="The ideas behind linked note-taking"
          answer="These pages explain the concepts rather than the product: what a second brain is and what one actually needs, how a Zettelkasten works and which parts of it were a workaround for paper, what a knowledge graph shows you that search cannot, and how to choose a note-taking app you will still be using in five years."
          meta={`${TOPICS_BY_RANK.length} guides`}
        />

        <Section
          heading="Written to be useful without the product"
          body={[
            "Every page here would still be worth reading if Nodum did not exist. That is a deliberate constraint: a guide whose real argument is \"and this is why you should buy our thing\" teaches nothing, and a reader can tell within a paragraph.",
            "Where Nodum is relevant, it appears at the end of a section as one implementation among several — usually alongside Obsidian, Logseq or Notion, because those are what most people are actually choosing between. The [comparison pages](/alternatives) handle that argument properly.",
          ]}
        />

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">The guides</h2>
          <ul className="mk-hub-grid">
            {TOPICS_BY_RANK.map((t) => (
              <li key={t.slug}>
                <Link href={`/learn/${t.slug}`} className="mk-hub-card">
                  <span className="mk-hub-name">{t.title.split("—")[0].trim()}</span>
                  <span className="mk-hub-note">{t.description}</span>
                  <span className="mk-hub-tag">{t.eyebrow}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <FaqList faqs={FAQS} />

        <RelatedLinks
          links={[
            { label: `Glossary — ${GLOSSARY.length} terms defined`, path: "/glossary" },
            { label: `Compare Nodum with ${ALTERNATIVES.length} other apps`, path: "/alternatives" },
            { label: "Documentation", path: "/docs" },
            { label: "Frequently asked questions", path: "/faq" },
          ]}
        />

        <CtaBand />
      </div>
    </>
  );
}
