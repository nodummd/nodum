import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import { Breadcrumbs, CtaBand, RelatedLinks, SeoHero } from "@/components/seo/page-parts";
import { Prose } from "@/components/seo/prose";
import { ALTERNATIVES } from "@/content/seo/alternatives";
import { FAQS, FAQS_BY_GROUP } from "@/content/seo/faq";
import { pageMetadata } from "@/lib/seo/metadata";
import * as ld from "@/lib/seo/jsonld";

const PATH = "/faq";
const TRAIL = [
  { name: "Nodum", path: "/" },
  { name: "FAQ", path: PATH },
];

export const metadata: Metadata = pageMetadata({
  title: "FAQ — what it is, what it costs, and what it will not do",
  description:
    "Straight answers about Nodum: the licence, the price, importing an Obsidian vault, the graph, AI and MCP, self-hosting, and the things it deliberately does not do.",
  path: PATH,
  keywords: [
    "nodum",
    "is nodum free",
    "is nodum open source",
    "nodum obsidian import",
    "nodum self hosted",
    "nodum ai",
    "nodum mcp",
  ],
});

export default function FaqPage() {
  return (
    <>
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path: PATH,
            name: "Nodum FAQ",
            description: metadata.description as string,
            breadcrumbId: ld.breadcrumbId(PATH),
          }),
          ld.breadcrumbs(TRAIL),
          // The whole set, not a sample: this is the page an AI engine should
          // be able to answer any Nodum question from in a single fetch.
          ld.faqPage(
            PATH,
            FAQS.map(({ question, answer }) => ({ question, answer })),
          ),
        )}
      />

      <div className="mk-seo-page">
        <Breadcrumbs trail={TRAIL} />

        <SeoHero
          eyebrow="FAQ"
          title="Questions, answered without the marketing voice"
          answer="Nodum is a free, open-source, web-based knowledge base: markdown notes, [[wikilinks]], automatic backlinks and a GPU-rendered knowledge graph, MIT licensed and self-hostable. Below are the questions people actually ask — including the ones where the answer is no."
          meta={`${FAQS.length} questions`}
        />

        {FAQS_BY_GROUP.map(({ group, faqs }) => (
          <section key={group} className="mk-seo-section" id={group.toLowerCase().replace(/\s+/g, "-")}>
            <h2 className="mk-seo-h2">{group}</h2>
            <div className="mk-faq">
              {faqs.map((faq) => (
                <div key={faq.question} className="mk-faq-item">
                  <h3 className="mk-faq-q">{faq.question}</h3>
                  <Prose className="mk-prose mk-faq-a">{faq.answer}</Prose>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">Not answered here?</h2>
          <p className="mk-hub-note mt-2">
            The <Link href="/docs">documentation</Link> covers every panel and shortcut with a
            screenshot from the running app. The <Link href="/glossary">glossary</Link> defines the
            vocabulary. The <Link href="/alternatives">alternatives pages</Link> compare Nodum with
            {ALTERNATIVES.length} other tools, including what each of them does better. Everything else is in the
            source, which is the point of it being open.
          </p>
        </section>

        <RelatedLinks
          links={[
            { label: "Open-source Obsidian alternative", path: "/alternatives/obsidian" },
            { label: "Self-hosting Nodum", path: "/learn/self-hosted-notes" },
            { label: "AI note-taking and MCP", path: "/learn/ai-note-taking" },
            { label: "Documentation", path: "/docs" },
          ]}
        />

        <CtaBand />
      </div>
    </>
  );
}
