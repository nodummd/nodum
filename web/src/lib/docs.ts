
// Server-only by construction: this module reads the filesystem, and only
// server components and route handlers import it.
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The documentation lives as markdown in `src/content/docs/`, one file per
 * article, read at build time. Frontmatter is deliberately tiny — title,
 * section, order, summary, where — so a hand-parser does; no dependency for
 * five keys.
 */

export interface DocArticle {
  slug: string;
  title: string;
  section: string;
  order: number;
  summary: string;
  /** Where in the interface this lives ("Ribbon → Graph (⌘G)"). */
  where?: string;
  body: string;
  /** H2 headings, for the nav's search. */
  headings: string[];
}

/** Section order on the nav — the order a new user needs them in. */
export const DOC_SECTIONS = [
  "Start here",
  "Notes",
  "Links & graph",
  "Finding things",
  "Workspace",
  "Organising",
  "Sharing",
  "Extending",
  "Account",
] as const;

const DOCS_DIR = path.join(process.cwd(), "src", "content", "docs");

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    meta[key] = value;
  }
  return { meta, body: raw.slice(end + 4).replace(/^\n+/, "") };
}

let cache: DocArticle[] | null = null;

export async function loadDocs(): Promise<DocArticle[]> {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const files = (await fs.readdir(DOCS_DIR)).filter((f) => f.endsWith(".md")).sort();
  const articles: DocArticle[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(DOCS_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, "");
    articles.push({
      slug,
      title: meta.title ?? slug,
      section: meta.section ?? "Workspace",
      order: Number(meta.order ?? 100),
      summary: meta.summary ?? "",
      where: meta.where || undefined,
      body,
      headings: [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()),
    });
  }
  articles.sort((a, b) => {
    const sa = DOC_SECTIONS.indexOf(a.section as (typeof DOC_SECTIONS)[number]);
    const sb = DOC_SECTIONS.indexOf(b.section as (typeof DOC_SECTIONS)[number]);
    return sa - sb || a.order - b.order || a.title.localeCompare(b.title);
  });
  cache = articles;
  return articles;
}

export async function loadDoc(slug: string): Promise<DocArticle | null> {
  return (await loadDocs()).find((a) => a.slug === slug) ?? null;
}
