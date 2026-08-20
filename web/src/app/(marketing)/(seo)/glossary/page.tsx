import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import { Breadcrumbs, CtaBand, RelatedLinks, Section, SeoHero } from "@/components/seo/page-parts";
import { GLOSSARY, GLOSSARY_BY_GROUP } from "@/content/seo/glossary";
import { pageMetadata } from "@/lib/seo/metadata";
import * as ld from "@/lib/seo/jsonld";
import { absolute } from "@/lib/seo/site";

const PATH = "/glossary";
const TRAIL = [
  { name: "Nodum", path: "/" },
  { name: "Glossary", path: PATH },
];

export const metadata: Metadata = pageMetadata({
  title: "Glossary — wikilinks, backlinks, Zettelkasten and 33 more",
  description:
    "Plain definitions of the vocabulary linked-note apps use: wikilink, backlink, transclusion, Zettelkasten, second brain, MOC, frontmatter, local-first and more.",
  path: PATH,
  keywords: [
    "wikilink",
    "backlink",
    "zettelkasten",
    "second brain",
    "knowledge graph",
    "map of content",
    "transclusion",
    "frontmatter",
    "pkm glossary",
  ],
});

export default function GlossaryPage() {
  return (
    <>
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path: PATH,
            name: "Knowledge-management glossary",
            description: metadata.description as string,
            breadcrumbId: ld.breadcrumbId(PATH),
          }),
          ld.breadcrumbs(TRAIL),
          {
            "@type": "DefinedTermSet",
            "@id": `${absolute(PATH)}#set`,
            name: "Nodum knowledge-management glossary",
            url: absolute(PATH),
            description:
              "Definitions of the terms used in linked-note and personal-knowledge-management software.",
            hasDefinedTerm: GLOSSARY.map((t) => ({ "@id": `${absolute(PATH)}#term-${t.id}` })),
          },
          ...GLOSSARY.map((t) => ({
            ...ld.definedTerm({
              path: PATH,
              term: t.term,
              definition: t.definition,
              alternateNames: t.aka,
            }),
            // Override the shared id so each term is addressable at its anchor.
            "@id": `${absolute(PATH)}#term-${t.id}`,
            url: `${absolute(PATH)}#${t.id}`,
          })),
        )}
      />

      <div className="mk-seo-page">
        <Breadcrumbs trail={TRAIL} />

        <SeoHero
          eyebrow="Glossary"
          title="The vocabulary of linked notes, defined plainly"
          answer="Linked-note software has accumulated its own vocabulary — wikilinks, backlinks, transclusion, Zettelkasten, maps of content, frontmatter — most of it borrowed from wikis, academia and hypertext research. These are the working definitions, each written to be understandable without the others."
          meta={`${GLOSSARY.length} terms`}
        />

        <ul className="mk-gloss-jump" aria-label="Jump to a section">
          {GLOSSARY_BY_GROUP.map(({ group }) => (
            <li key={group}>
              <a href={`#${group.toLowerCase()}`}>{group}</a>
            </li>
          ))}
        </ul>

        {GLOSSARY_BY_GROUP.map(({ group, terms }) => (
          <section key={group} className="mk-gloss-group" id={group.toLowerCase()}>
            <h2 className="mk-seo-h2">{group}</h2>
            <dl>
              {terms.map((t) => (
                <div key={t.id} className="mk-gloss-term" id={t.id}>
                  <dt className="mk-gloss-name">
                    {t.term}
                    {t.aka && <span className="mk-gloss-aka">also: {t.aka.join(", ")}</span>}
                  </dt>
                  <dd>
                    <p className="mk-gloss-def">{t.definition}</p>
                    {t.detail && <p className="mk-gloss-def">{t.detail}</p>}
                    {t.more && (
                      <Link href={t.more.path} className="mk-gloss-more">
                        {t.more.label} →
                      </Link>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <Section
          heading="Why the vocabulary matters"
          body={[
            "Most of these words describe one mechanic each, and the mechanics are what actually differ between tools. Two apps can both say they support \"linking\" and mean completely different things — one means a hyperlink, the other means a wikilink with an automatic reverse view and a graph edge.",
            "So when comparing tools, translate the marketing into these terms first. It usually resolves the comparison in about a minute. The [alternatives pages](/alternatives) do exactly that, tool by tool.",
          ]}
        />

        <RelatedLinks
          links={[
            { label: "Backlinks and wikilinks, in depth", path: "/learn/backlinks" },
            { label: "What a knowledge graph shows you", path: "/learn/knowledge-graph" },
            { label: "Zettelkasten, without the mystique", path: "/learn/zettelkasten" },
            { label: "Building a second brain", path: "/learn/second-brain" },
          ]}
        />

        <CtaBand
          title="The words are easier with a vault in front of you."
          body="Make one, type two square brackets, and watch the other side of the link appear."
        />
      </div>
    </>
  );
}
