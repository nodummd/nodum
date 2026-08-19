import type { Metadata } from "next";

import { DocsNav } from "@/components/docs/docs-nav";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { DOC_SECTIONS, loadDocs } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation · Nodum",
  description:
    "What every part of Nodum is for — the explorer, the editor, links and the graph, search, vaults, AI and MCP — with an example and a screenshot for each.",
};

/** The docs shell: site chrome, the article rail, the page. Public and
 *  static — a person should be able to read this before they have an account. */
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const docs = await loadDocs();
  const items = docs.map(({ slug, title, section, summary, headings, text }) => ({
    slug,
    title,
    section,
    summary,
    headings,
    text,
  }));
  return (
    <>
      <SiteNav />
      <div className="mk-docs">
        <aside className="mk-docs-rail">
          <DocsNav items={items} sections={DOC_SECTIONS} />
        </aside>
        <main className="mk-docs-main">{children}</main>
      </div>
      <SiteFooter />
    </>
  );
}
