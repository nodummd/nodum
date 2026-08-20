import Link from "next/link";

import type { Faq } from "@/lib/seo/jsonld";

import { Prose, ProseInline } from "./prose";

/**
 * The shared furniture of every SEO page: breadcrumbs, the hero with its
 * answer block, prose sections, an FAQ list, related links and a closing CTA.
 *
 * All server components. The important one is `AnswerBlock`: it is the first
 * text on the page, it is 40–60 words, and it is written to be true on its own
 * — because that is the passage an AI Overview or a Perplexity answer lifts,
 * and it travels without the heading above it.
 */

export function Breadcrumbs({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mk-crumbs">
      <ol>
        {trail.map((step, i) => (
          <li key={step.path}>
            {i === trail.length - 1 ? (
              <span aria-current="page">{step.name}</span>
            ) : (
              <>
                <Link href={step.path}>{step.name}</Link>
                <span aria-hidden className="mk-crumb-sep">
                  /
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SeoHero({
  eyebrow,
  title,
  answer,
  meta,
}: {
  eyebrow: string;
  title: string;
  answer: string;
  /** Small line under the answer — "Checked August 2026", say. */
  meta?: React.ReactNode;
}) {
  return (
    <header className="mk-seo-hero">
      <p className="mk-eyebrow">{eyebrow}</p>
      <h1 className="mk-display mt-3 text-[clamp(2rem,5vw,3.2rem)]">{title}</h1>
      <AnswerBlock>{answer}</AnswerBlock>
      {meta && <p className="mk-seo-meta">{meta}</p>}
    </header>
  );
}

/** The quotable paragraph. Styled to read as the page's thesis, not an aside. */
export function AnswerBlock({ children }: { children: string }) {
  return (
    <div className="mk-answer">
      <p>
        <ProseInline>{children}</ProseInline>
      </p>
    </div>
  );
}

export function Section({
  heading,
  id,
  body,
  bullets,
}: {
  heading: string;
  id?: string;
  body: string[];
  bullets?: string[];
}) {
  return (
    <section className="mk-seo-section" id={id}>
      <h2 className="mk-seo-h2">{heading}</h2>
      {body.map((paragraph) => (
        <Prose key={paragraph.slice(0, 48)}>{paragraph}</Prose>
      ))}
      {bullets && bullets.length > 0 && (
        <ul className="mk-seo-list">
          {bullets.map((item) => (
            <li key={item.slice(0, 48)}>
              <ProseInline>{item}</ProseInline>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A two-column "they win / we win" pair. The left column is the credibility. */
export function ScoreColumns({
  leftTitle,
  left,
  rightTitle,
  right,
}: {
  leftTitle: string;
  left: string[];
  rightTitle: string;
  right: string[];
}) {
  return (
    <div className="mk-seo-cols">
      <div className="mk-card p-6">
        <h3 className="mk-seo-h3">{leftTitle}</h3>
        <ul className="mk-seo-list mk-seo-list--tight">
          {left.map((item) => (
            <li key={item.slice(0, 48)}>
              <ProseInline>{item}</ProseInline>
            </li>
          ))}
        </ul>
      </div>
      <div className="mk-card mk-card--accent p-6">
        <h3 className="mk-seo-h3">{rightTitle}</h3>
        <ul className="mk-seo-list mk-seo-list--tight">
          {right.map((item) => (
            <li key={item.slice(0, 48)}>
              <ProseInline>{item}</ProseInline>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Checklist({
  heading,
  intro,
  items,
}: {
  heading: string;
  intro?: string;
  items: string[];
}) {
  return (
    <section className="mk-seo-section">
      <h2 className="mk-seo-h2">{heading}</h2>
      {intro && <Prose>{intro}</Prose>}
      <ul className="mk-seo-check">
        {items.map((item) => (
          <li key={item.slice(0, 48)}>
            <ProseInline>{item}</ProseInline>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * FAQ list. Rendered as plain headings and paragraphs rather than <details>:
 * both are indexable, but an open answer is what gets read, and there is no
 * interaction here worth the collapse.
 */
export function FaqList({ faqs, heading = "Questions people ask" }: { faqs: readonly Faq[]; heading?: string }) {
  if (faqs.length === 0) return null;
  return (
    <section className="mk-seo-section" id="faq">
      <h2 className="mk-seo-h2">{heading}</h2>
      <div className="mk-faq">
        {faqs.map((faq) => (
          <div key={faq.question} className="mk-faq-item">
            <h3 className="mk-faq-q">{faq.question}</h3>
            <Prose className="mk-prose mk-faq-a">{faq.answer}</Prose>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RelatedLinks({
  links,
  heading = "Related reading",
}: {
  links: { label: string; path: string }[];
  heading?: string;
}) {
  if (links.length === 0) return null;
  return (
    <section className="mk-seo-section">
      <h2 className="mk-seo-h2">{heading}</h2>
      <ul className="mk-seo-related">
        {links.map((link) => (
          <li key={link.path}>
            <Link href={link.path}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CtaBand({
  title = "Start tying things together.",
  body = "A vault takes about ten seconds to make. Bring notes with you, or start with one.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <section className="mk-seo-cta">
      <h2 className="mk-display text-[clamp(1.6rem,3.5vw,2.4rem)]">{title}</h2>
      <p className="mt-3 text-[var(--mk-muted)]">{body}</p>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/signup" className="mk-btn mk-btn--primary w-full sm:w-auto">
          Start your vault
        </Link>
        <Link href="/docs" className="mk-btn mk-btn--ghost w-full sm:w-auto">
          Read the docs
        </Link>
      </div>
    </section>
  );
}
