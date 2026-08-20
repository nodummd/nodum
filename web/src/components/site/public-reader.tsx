"use client";

import { useRouter } from "next/navigation";

import { ReadingView } from "@/components/editor/reading-view";

/**
 * Renders a published note's markdown and resolves its wikilinks against the
 * site's own note list.
 *
 * The only reason this is a client component is `onNavigate` — a function,
 * which cannot cross the server/client boundary as a prop. Everything it needs
 * arrives as serialisable data from the server, so the rendered markdown is
 * present in the initial HTML and hydration only attaches the click handler.
 */
export function PublicReader({
  content,
  slug,
  notes,
}: {
  content: string;
  /** Null on a token-published note, which has no sibling notes to link to. */
  slug: string | null;
  notes: { title: string; path: string }[];
}) {
  const router = useRouter();

  const navigate = (target: string) => {
    if (!slug) return;
    const wanted = target.split("#")[0].trim().toLowerCase();
    const match = notes.find(
      (n) => n.path.toLowerCase() === wanted || n.title.toLowerCase() === wanted,
    );
    if (match) {
      router.push(`/s/${slug}/${match.path.split("/").map(encodeURIComponent).join("/")}`);
    }
  };

  // vaultId is empty on public pages: there is no vault session, so attachment
  // and embed lookups are inert by design.
  return <ReadingView content={content} vaultId="" onNavigate={navigate} depth={2} />;
}
