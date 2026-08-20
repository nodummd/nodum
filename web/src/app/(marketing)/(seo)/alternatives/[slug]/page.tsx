import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/seo/json-ld";
import {
  Breadcrumbs,
  Checklist,
  CtaBand,
  FaqList,
  RelatedLinks,
  ScoreColumns,
  Section,
  SeoHero,
} from "@/components/seo/page-parts";
import { ProseInline } from "@/components/seo/prose";
import {
  ALTERNATIVES,
  ALTERNATIVE_SLUGS,
  CHECKED,
  NODUM_FACTS,
  getAlternative,
  type AlternativeFacts,
} from "@/content/seo/alternatives";
import { pageMetadata } from "@/lib/seo/metadata";
import * as ld from "@/lib/seo/jsonld";

/** Static at build time: 19 pages, all from a data file, none dynamic. */
export function generateStaticParams() {
  return ALTERNATIVE_SLUGS.map((slug) => ({ slug }));
}

/** Row order for the facts table — licence first, because that is the point. */
const FACT_ROWS: { key: keyof AlternativeFacts; label: string }[] = [
  { key: "license", label: "Licence" },
  { key: "hosting", label: "Hosting" },
  { key: "storage", label: "Your notes are" },
  { key: "linking", label: "Linking" },
  { key: "graph", label: "Graph" },
  { key: "pricing", label: "Pricing model" },
  { key: "platforms", label: "Platforms" },
  { key: "export", label: "Getting out" },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const alt = getAlternative((await params).slug);
  if (!alt) return { title: "Not found" };
  return pageMetadata({
    title: alt.metaTitle ?? alt.headline,
    description: alt.description,
    path: `/alternatives/${alt.slug}`,
    keywords: alt.keywords,
    type: "article",
    modifiedTime: CHECKED,
  });
}

export default async function AlternativePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const alt = getAlternative(slug);
  if (!alt) notFound();

  const path = `/alternatives/${alt.slug}`;
  const trail = [
    { name: "Nodum", path: "/" },
    { name: "Alternatives", path: "/alternatives" },
    { name: alt.name, path },
  ];

  // Neighbouring comparisons, so every page passes authority to the cluster
  // rather than dead-ending. Ranked neighbours, wrapping at the ends.
  const others = ALTERNATIVES.filter((a) => a.slug !== alt.slug)
    .sort((a, b) => Math.abs(a.rank - alt.rank) - Math.abs(b.rank - alt.rank))
    .slice(0, 4);

  return (
    <>
      <JsonLd
        data={ld.graph(
          ld.webPage({
            path,
            name: alt.headline,
            description: alt.description,
            breadcrumbId: ld.breadcrumbId(path),
            dateModified: CHECKED,
          }),
          ld.breadcrumbs(trail),
          ld.article({
            path,
            headline: alt.headline,
            description: alt.description,
            section: "Alternatives",
            dateModified: CHECKED,
          }),
          ld.comparedApplication({
            name: alt.name,
            url: alt.url,
            description: alt.what,
          }),
          ld.faqPage(path, alt.faqs),
          ...(alt.migration
            ? [
                ld.howTo({
                  path,
                  name: `How to move from ${alt.name} to Nodum`,
                  description: `Migrating a ${alt.name} library into a Nodum vault, step by step.`,
                  steps: alt.migration.steps,
                }),
              ]
            : []),
        )}
      />

      <div className="mk-seo-page">
        <Breadcrumbs trail={trail} />

        <SeoHero
          eyebrow={`Nodum vs ${alt.name}`}
          title={alt.headline}
          answer={alt.answer}
          meta={
            <>
              Facts checked{" "}
              {new Date(CHECKED).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {" · "}
              <a href={alt.url} target="_blank" rel="noreferrer noopener">
                {alt.name}&rsquo;s own site
              </a>
            </>
          }
        />

        <Section heading={`What ${alt.name} is`} body={[alt.what]} />

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">Side by side</h2>
          <div className="mk-facts">
            <div className="mk-facts-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Property</span>
                    </th>
                    <th scope="col">{alt.name}</th>
                    <th scope="col">Nodum</th>
                  </tr>
                </thead>
                <tbody>
                  {FACT_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{alt.facts[row.key]}</td>
                      <td className="mk-facts-ours">{NODUM_FACTS[row.key]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">Where each one actually wins</h2>
          <p className="mk-hub-note mt-2">
            The left-hand column is the honest part. If none of it applies to you, the switch is
            probably worth making; if several do, it probably is not.
          </p>
          <ScoreColumns
            leftTitle={`What ${alt.name} does better`}
            left={alt.theyWin}
            rightTitle="What Nodum does better"
            right={alt.weWin}
          />
        </section>

        <section className="mk-seo-section">
          <h2 className="mk-seo-h2">So — switch, or stay?</h2>
          <div className="mk-seo-cols">
            <div className="mk-card mk-card--accent p-6">
              <h3 className="mk-seo-h3">Switch to Nodum if…</h3>
              <ul className="mk-seo-list mk-seo-list--tight">
                {alt.switchIf.map((item) => (
                  <li key={item.slice(0, 40)}>
                    <ProseInline>{item}</ProseInline>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mk-card p-6">
              <h3 className="mk-seo-h3">Stay on {alt.name} if…</h3>
              <ul className="mk-seo-list mk-seo-list--tight">
                {alt.stayIf.map((item) => (
                  <li key={item.slice(0, 40)}>
                    <ProseInline>{item}</ProseInline>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {alt.migration && (
          <section className="mk-seo-section">
            <h2 className="mk-seo-h2">Moving your notes across</h2>
            <ol className="mk-seo-list mk-migrate">
              {alt.migration.steps.map((step, i) => (
                <li key={step.name}>
                  <strong>
                    {i + 1}. {step.name}.
                  </strong>{" "}
                  <ProseInline>{step.text}</ProseInline>
                </li>
              ))}
            </ol>
            {alt.migration.note && (
              <p className="mk-hub-note mt-4">
                <ProseInline>{alt.migration.note}</ProseInline>
              </p>
            )}
          </section>
        )}

        <FaqList faqs={alt.faqs} heading={`${alt.name} and Nodum: common questions`} />

        <Checklist
          heading="Before you move anything"
          intro="Whatever you decide, run this once. It takes ten minutes and it is the difference between a migration and an incident."
          items={[
            `Export from ${alt.name} first, and keep that export somewhere safe.`,
            "Import a copy into a throwaway Nodum vault, not your main one.",
            "Open the graph and look for ghost nodes — those are links that did not resolve.",
            "Export the Nodum vault and diff it against what you put in.",
            "Only then delete anything.",
          ]}
        />

        <RelatedLinks
          heading="Other comparisons"
          links={others.map((o) => ({
            label: `Nodum vs ${o.name}`,
            path: `/alternatives/${o.slug}`,
          }))}
        />

        <p className="mk-hub-note mt-6">
          Every comparison is on the <Link href="/alternatives">alternatives index</Link>, and the{" "}
          <Link href="/glossary">glossary</Link> defines the vocabulary these pages use.
        </p>

        <CtaBand
          title={`Bring your ${alt.name} notes with you.`}
          body="Import a zip, look at the graph, export it again. Nothing about it is one-way."
        />
      </div>
    </>
  );
}
