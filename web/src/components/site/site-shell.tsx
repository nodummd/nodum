import Link from "next/link";

import type { PublicSiteData } from "@/lib/api/public-server";

/**
 * Chrome for a published vault site: the note rail and the reading column.
 *
 * A server component, so the whole navigation — every published note's title
 * and URL — is in the initial HTML. That is what makes the rest of the site
 * discoverable: a crawler that reaches one note reaches all of them, without
 * needing the sitemap.
 */
export function SiteShell({
  site,
  activePath,
  children,
}: {
  site: PublicSiteData;
  activePath: string | null;
  children: React.ReactNode;
}) {
  const href = (path: string) =>
    `/s/${site.slug}/${path.split("/").map(encodeURIComponent).join("/")}`;

  return (
    <div className="flex min-h-screen bg-ob-bg text-ob-text">
      <nav
        aria-label={`${site.vault_name} notes`}
        className="hidden w-64 shrink-0 border-r border-ob-border bg-ob-sidebar p-4 md:block"
      >
        <Link href={`/s/${site.slug}`} className="mb-4 block text-[15px] font-bold text-ob-text">
          {site.vault_name}
        </Link>
        <ul className="space-y-0.5">
          {site.notes.map((n) => (
            <li key={n.path}>
              <Link
                href={href(n.path)}
                aria-current={n.path === activePath ? "page" : undefined}
                className={
                  n.path === activePath
                    ? "bg-ob-active block truncate rounded px-2 py-1 text-[13px] text-ob-text"
                    : "block truncate rounded px-2 py-1 text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
                }
              >
                {n.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto w-full max-w-[44rem] px-6 py-10">{children}</main>
    </div>
  );
}

/** The one line of attribution a published site carries. */
export function SiteFooterNote({ slug }: { slug?: string }) {
  return (
    <footer className="mt-16 border-t border-ob-border pt-5 text-[12px] text-ob-faint">
      Published with{" "}
      <Link href="/" className="text-ob-accent hover:underline">
        Nodum
      </Link>{" "}
      — an open-source knowledge base.{" "}
      <Link href="/signup" className="text-ob-accent hover:underline">
        Start your own vault
      </Link>
      .{slug ? "" : ""}
    </footer>
  );
}
