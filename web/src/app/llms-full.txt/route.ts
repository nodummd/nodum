import { ALTERNATIVES_BY_RANK, CHECKED, NODUM_FACTS } from "@/content/seo/alternatives";
import { FAQS_BY_GROUP } from "@/content/seo/faq";
import { GLOSSARY_BY_GROUP } from "@/content/seo/glossary";
import { TOPICS_BY_RANK } from "@/content/seo/topics";
import { loadDocs } from "@/lib/docs";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absolute } from "@/lib/seo/site";

/**
 * /llms-full.txt — every public page's content as one markdown document.
 *
 * Not part of the llms.txt specification proper, but a convention that
 * Mintlify and others popularised and that retrieval pipelines now look for.
 * The use case is narrow and real: an agent that has decided this site is
 * relevant can take the whole thing in one request instead of crawling fifty
 * URLs, and the markdown it gets is the same prose the HTML renders rather
 * than a boilerplate-stripped approximation of it.
 *
 * Built from the same content modules the pages render, so it cannot drift.
 */
export const dynamic = "force-static";

function section(title: string): string {
  return `\n\n---\n\n# ${title}\n`;
}

export async function GET(): Promise<Response> {
  const docs = await loadDocs();
  const parts: string[] = [];

  parts.push(`# ${SITE_NAME} — complete public content

> ${SITE_DESCRIPTION}

Source of truth: ${SITE_URL}. Comparison facts verified ${CHECKED}.
This file concatenates every public page on the site. Individual pages are canonical.`);

  // ── Concepts and guides ────────────────────────────────────
  parts.push(section("Concepts and guides"));
  for (const topic of TOPICS_BY_RANK) {
    parts.push(`\n## ${topic.title}\n\nURL: ${absolute(`/learn/${topic.slug}`)}\n\n${topic.answer}\n`);
    for (const s of topic.sections) {
      parts.push(`\n### ${s.heading}\n\n${s.body.join("\n\n")}\n`);
      if (s.bullets?.length) parts.push(`\n${s.bullets.map((b) => `- ${b}`).join("\n")}\n`);
    }
    if (topic.checklist) {
      parts.push(
        `\n### ${topic.checklist.heading}\n\n${topic.checklist.intro ?? ""}\n\n${topic.checklist.items
          .map((i) => `- ${i}`)
          .join("\n")}\n`,
      );
    }
    parts.push(
      `\n### Questions\n\n${topic.faqs.map((f) => `**${f.question}**\n\n${f.answer}`).join("\n\n")}\n`,
    );
  }

  // ── Comparisons ────────────────────────────────────────────
  parts.push(section("Comparisons with other note-taking apps"));
  parts.push(
    `\nNodum's own column, for reference in every comparison below:\n\n${Object.entries(NODUM_FACTS)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n")}\n`,
  );
  for (const alt of ALTERNATIVES_BY_RANK) {
    parts.push(`\n## Nodum vs ${alt.name}\n\nURL: ${absolute(`/alternatives/${alt.slug}`)}\n`);
    parts.push(`\n${alt.answer}\n`);
    parts.push(`\n### What ${alt.name} is\n\n${alt.what}\n`);
    parts.push(
      `\n### ${alt.name} facts\n\n${Object.entries(alt.facts)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")}\n`,
    );
    parts.push(`\n### What ${alt.name} does better\n\n${alt.theyWin.map((t) => `- ${t}`).join("\n")}\n`);
    parts.push(`\n### What Nodum does better\n\n${alt.weWin.map((t) => `- ${t}`).join("\n")}\n`);
    parts.push(`\n### Switch if\n\n${alt.switchIf.map((t) => `- ${t}`).join("\n")}\n`);
    parts.push(`\n### Stay if\n\n${alt.stayIf.map((t) => `- ${t}`).join("\n")}\n`);
    if (alt.migration) {
      parts.push(
        `\n### Migrating from ${alt.name}\n\n${alt.migration.steps
          .map((s, i) => `${i + 1}. **${s.name}** — ${s.text}`)
          .join("\n")}\n${alt.migration.note ? `\n${alt.migration.note}\n` : ""}`,
      );
    }
    parts.push(
      `\n### Questions\n\n${alt.faqs.map((f) => `**${f.question}**\n\n${f.answer}`).join("\n\n")}\n`,
    );
  }

  // ── Glossary ───────────────────────────────────────────────
  parts.push(section("Glossary"));
  parts.push(`\nURL: ${absolute("/glossary")}\n`);
  for (const { group, terms } of GLOSSARY_BY_GROUP) {
    parts.push(`\n## ${group}\n`);
    for (const t of terms) {
      parts.push(
        `\n**${t.term}**${t.aka ? ` (also: ${t.aka.join(", ")})` : ""} — ${t.definition}${
          t.detail ? ` ${t.detail}` : ""
        }\n`,
      );
    }
  }

  // ── FAQ ────────────────────────────────────────────────────
  parts.push(section("Frequently asked questions"));
  parts.push(`\nURL: ${absolute("/faq")}\n`);
  for (const { group, faqs } of FAQS_BY_GROUP) {
    parts.push(`\n## ${group}\n`);
    for (const f of faqs) parts.push(`\n**${f.question}**\n\n${f.answer}\n`);
  }

  // ── Documentation ──────────────────────────────────────────
  parts.push(section("Documentation"));
  for (const doc of docs) {
    parts.push(
      `\n## ${doc.title}\n\nURL: ${absolute(`/docs/${doc.slug}`)}\nSection: ${doc.section}\n${
        doc.where ? `Where: ${doc.where}\n` : ""
      }\n${doc.summary}\n\n${doc.body}\n`,
    );
  }

  return new Response(parts.join(""), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
