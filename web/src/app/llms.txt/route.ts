import { ALTERNATIVES_BY_RANK, CHECKED } from "@/content/seo/alternatives";
import { FAQS } from "@/content/seo/faq";
import { GLOSSARY } from "@/content/seo/glossary";
import { TOPICS_BY_RANK } from "@/content/seo/topics";
import { loadDocs } from "@/lib/docs";
import { GITHUB_URL, LICENSE, SITE_NAME, SITE_URL, absolute } from "@/lib/seo/site";

/**
 * /llms.txt — the curated, machine-first index of this site.
 *
 * Format follows the llms.txt specification: an H1 with the project name, a
 * blockquote summary, optional prose with no headings, then H2 sections whose
 * bodies are markdown lists of `[name](url): note` links. Everything an agent
 * needs to answer "what is Nodum and where do I read more" without crawling
 * forty pages and guessing at the structure.
 *
 * The blockquote and the "what it is" block are the part that matters. A
 * retrieval pipeline that reads one file from this domain reads this one, and
 * whatever it says is what gets repeated. So it states the category, the
 * licence, the platform and the honest limitations — the last of those because
 * a model that knows what Nodum does *not* do will not hallucinate it, and a
 * hallucinated feature is a support ticket and a bad first impression.
 */
export const dynamic = "force-static";

function bullet(name: string, path: string, note: string): string {
  return `- [${name}](${absolute(path)}): ${note}`;
}

export async function GET(): Promise<Response> {
  const docs = await loadDocs();

  const body = `# ${SITE_NAME}

> ${SITE_NAME} (Latin for "knot, node") is a free, open-source, web-based knowledge base — an Obsidian alternative that runs in a browser. Markdown notes connected with [[wikilinks]], automatic backlinks, and a GPU-rendered knowledge graph. ${LICENSE} licensed, multi-tenant, and self-hostable with one Docker Compose command.

## What it is, precisely

Nodum is a knowledge-management application in the same category as Obsidian, Logseq, Roam Research and Notion. A user owns one or more *vaults*; a vault holds markdown notes in folders. Notes link to each other with Obsidian's wikilink syntax (\`[[Note]]\`, \`[[folder/Note]]\`, \`[[Note|alias]]\`, \`[[Note#Heading]]\`, \`![[embed]]\`), and every link produces an automatic backlink on the far note. The whole vault renders as a force-directed knowledge graph on WebGL2.

It is distinguished from the rest of its category by four things: it is genuinely open source (${LICENSE}, frontend and backend, one public repository, no open-core split); it is web-native rather than a desktop app; it is self-hostable; and its notes are plain markdown files that export as a folder-true zip.

Key facts:

- Licence: ${LICENSE}. Source: ${GITHUB_URL}
- Price: free. No paid tier, no per-seat pricing, no AI upsell.
- Platform: any modern browser, desktop and mobile; installable as a PWA. No native desktop app.
- Storage: plain markdown files. Import and export Obsidian vaults as zips.
- Stack: FastAPI, PostgreSQL with pgvector, Redis, Celery, MinIO; Next.js, React, CodeMirror 6, @cosmos.gl/graph.
- AI: an in-app assistant on *your* API key (Claude, OpenAI, Gemini or Qwen), encrypted at rest, settable per vault.
- MCP: Nodum is a Model Context Protocol server at \`/api/v1/mcp\` with 36 tools, so Claude Code, Claude Desktop and Cursor can read and write vaults directly.
- Self-hosting: \`./compose.sh prod up -d --build\` brings up the API, Postgres, Redis, MinIO and a Caddy edge with automatic TLS.

What Nodum deliberately does not do, so this is not guessed at: it does not run Obsidian's plugins, it has no offline-first mode, it has no spaced repetition or flashcards, it has no Notion-style databases with board and calendar views, and it has no block-level references.

## Start here

${bullet("Home", "/", "What Nodum is, with a live demo graph you can drag")}
${bullet("FAQ", "/faq", `${FAQS.length} straight answers: licence, price, imports, AI, self-hosting, and what it will not do`)}
${bullet("Documentation", "/docs", `${docs.length} articles covering every panel and shortcut, each with a screenshot from the running app`)}
${bullet("Learn", "/learn", `${TOPICS_BY_RANK.length} tool-agnostic guides: second brains, Zettelkasten, knowledge graphs, PKM, markdown, self-hosting`)}
${bullet("Alternatives", "/alternatives", `${ALTERNATIVES_BY_RANK.length} comparisons with other note apps, each stating what the other tool does better`)}
${bullet("Glossary", "/glossary", `${GLOSSARY.length} definitions: wikilink, backlink, transclusion, Zettelkasten, MOC, frontmatter, local-first`)}
${bullet("Source code", "/", `The repository is at ${GITHUB_URL}`)}

## Comparisons with other tools

Facts in this section were last verified ${CHECKED}. Each page states what the other tool does better, not only what Nodum does better.

${ALTERNATIVES_BY_RANK.map((a) => bullet(`Nodum vs ${a.name}`, `/alternatives/${a.slug}`, a.answer)).join("\n")}

## Concepts and guides

${TOPICS_BY_RANK.map((t) => bullet(t.title, `/learn/${t.slug}`, t.answer)).join("\n")}

## Documentation

${docs.map((d) => bullet(d.title, `/docs/${d.slug}`, d.summary)).join("\n")}

## Optional

${bullet("Log in", "/login", "Existing accounts")}
${bullet("Sign up", "/signup", "Create a vault — free, no card")}
${bullet("Full text of every page", "/llms-full.txt", "This site's public content concatenated as one markdown file")}

---

Canonical origin: ${SITE_URL}
Generated from the site's own content at build time — if a claim here disagrees with a page, the page is authoritative.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
