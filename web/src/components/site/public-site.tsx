"use client";

/** Published vault site — /s/{slug} public reader with a note nav. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ReadingView } from "@/components/editor/reading-view";
import { siteApi } from "@/lib/api/endpoints";

export function PublicSiteView({ slug, path }: { slug: string; path: string | null }) {
  const router = useRouter();
  const { data: site, isError: siteError } = useQuery({
    queryKey: ["public-site", slug],
    queryFn: () => siteApi.readSite(slug),
    retry: false,
  });
  const { data: note, isError: noteError } = useQuery({
    queryKey: ["public-site-note", slug, path],
    queryFn: () => siteApi.readNote(slug, path as string),
    enabled: Boolean(path),
    retry: false,
  });

  if (siteError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ob-bg text-ob-muted">
        <p>This site doesn’t exist or is no longer published.</p>
      </main>
    );
  }
  if (!site) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ob-bg text-ob-faint">
        <p>Loading…</p>
      </main>
    );
  }

  const navigate = (target: string) => {
    const wanted = target.split("#")[0].trim().toLowerCase();
    const match = site.notes.find(
      (n) => n.path.toLowerCase() === wanted || n.title.toLowerCase() === wanted,
    );
    if (match) {
      router.push(`/s/${slug}/${match.path.split("/").map(encodeURIComponent).join("/")}`);
    }
  };

  return (
    <div className="flex min-h-screen bg-ob-bg text-ob-text">
      <nav className="hidden w-64 shrink-0 border-r border-ob-border bg-ob-sidebar p-4 md:block">
        <Link href={`/s/${slug}`} className="mb-4 block text-[15px] font-bold text-ob-text">
          {site.vault_name}
        </Link>
        <ul className="space-y-0.5">
          {site.notes.map((n) => (
            <li key={n.path}>
              <Link
                href={`/s/${slug}/${n.path.split("/").map(encodeURIComponent).join("/")}`}
                className={
                  n.path === path
                    ? "block truncate rounded px-2 py-1 bg-ob-active text-[13px] text-ob-text"
                    : "block truncate rounded px-2 py-1 text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
                }
              >
                {n.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto w-full max-w-[44rem] px-6 py-10">
        {path === null ? (
          <>
            <h1 className="mb-2 text-[1.802em] font-bold">{site.vault_name}</h1>
            <p className="mb-6 text-[13px] text-ob-faint">
              A published Nodum vault · {site.notes.length} notes
            </p>
            <ul className="space-y-1 md:hidden">
              {site.notes.map((n) => (
                <li key={n.path}>
                  <Link
                    href={`/s/${slug}/${n.path.split("/").map(encodeURIComponent).join("/")}`}
                    className="text-ob-accent hover:underline"
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="hidden text-[14px] text-ob-muted md:block">
              Pick a note from the sidebar to start reading.
            </p>
          </>
        ) : noteError ? (
          <p className="text-ob-muted">This note isn’t part of the published site.</p>
        ) : note ? (
          <>
            <h1 className="mb-6 text-[1.802em] font-bold">{note.title}</h1>
            {/* vaultId is unused for public rendering (no attachments/embeds fetch) */}
            <ReadingView content={note.content} vaultId="" onNavigate={navigate} depth={2} />
          </>
        ) : (
          <p className="text-ob-faint">Loading…</p>
        )}
      </main>
    </div>
  );
}
