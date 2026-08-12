"use client";

/** Public published-note page — no auth, token is the capability. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ReadingView } from "@/components/editor/reading-view";
import { publishApi } from "@/lib/api/endpoints";

export default function PublicNotePage() {
  const { token } = useParams<{ token: string }>();

  const { data, isError, isPending } = useQuery({
    queryKey: ["public-note", token],
    queryFn: () => publishApi.readPublic(token),
    retry: false,
  });

  return (
    <main className="min-h-screen bg-ob-bg text-ob-text">
      <header className="border-b border-ob-border">
        <div className="mx-auto flex max-w-[44rem] items-center justify-between px-6 py-3">
          <span className="text-[13px] font-semibold tracking-tight">nodum</span>
          <Link
            href="/"
            className="text-[12px] text-ob-accent hover:underline"
          >
            Create your own vault →
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-[44rem] px-6 py-10">
        {isPending && <p className="text-[13px] text-ob-faint">Loading…</p>}
        {isError && (
          <div className="py-20 text-center">
            <h1 className="text-xl font-bold">Page not found</h1>
            <p className="mt-2 text-[14px] text-ob-muted">
              This note doesn&apos;t exist or was unpublished.
            </p>
          </div>
        )}
        {data && (
          <>
            <h1 className="mb-1 text-[1.802em] leading-tight font-bold">{data.title}</h1>
            <p className="mb-6 text-[12px] text-ob-faint">
              Published {new Date(data.published_at).toLocaleDateString()} · Updated{" "}
              {new Date(data.updated_at).toLocaleDateString()}
            </p>
            {/* Public pages have no vault access: wikilinks render inert */}
            <ReadingView content={data.content} vaultId="" onNavigate={() => undefined} />
          </>
        )}
      </article>
    </main>
  );
}
