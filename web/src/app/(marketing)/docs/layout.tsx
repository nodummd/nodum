import { DocsNav } from "@/components/docs/docs-nav";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { DOC_SECTIONS, loadDocs } from "@/lib/docs";

/**
 * No `metadata` export here, deliberately.
 *
 * It used to carry `title: "Documentation · Nodum"`, and because the root
 * layout defines a `%s · Nodum` template, every docs index rendered as
 * "Documentation · Nodum · Nodum". Worse, a `title` string on a layout
 * consumes the template for its descendants, so the article pages silently
 * stopped inheriting it too. Titles belong on pages, where `pageMetadata()`
 * also supplies the canonical URL these pages were missing entirely.
 */

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
