/**
 * Server-side reads of the public publishing endpoints.
 *
 * These pages used to fetch in the browser with TanStack Query, which meant the
 * HTML a crawler received said "Loading…" and nothing else. Every published
 * note on every published vault was invisible to search — not ranked badly,
 * absent. Fetching here instead puts the real title and body in the initial
 * response, which is also what makes `generateMetadata` able to produce a
 * truthful `<title>`, description and Open Graph card per note.
 *
 * The request goes straight to the API rather than through the Next.js rewrite
 * at `/api/*`: from inside the server that rewrite is a loopback to itself.
 * `API_PROXY_URL` is the same variable the rewrite uses, so there is one place
 * to configure and it is already set in every deployment.
 *
 * Server-only by construction — no `"use client"` file may import it, and the
 * endpoints it calls need no credentials, so nothing here can leak a session.
 */

const API_ORIGIN = (process.env.API_PROXY_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export interface PublicSiteData {
  slug: string;
  vault_name: string;
  notes: { title: string; path: string }[];
}

export interface PublicSiteNote {
  title: string;
  path: string;
  content: string;
  updated_at: string;
}

export interface PublicNote {
  title: string;
  content: string;
  updated_at: string;
  published_at: string;
}

/**
 * Returns null for anything that is not a 200 with a `data` envelope.
 *
 * `no-store`, deliberately. The obvious optimisation here is a few minutes of
 * `revalidate`, since published pages are read far more often than they change
 * — but unpublishing is a privacy action, and a cached copy would keep serving
 * a note the author has just withdrawn for the length of the window. Nothing
 * about that trade is worth a database query. The API is Redis-backed behind
 * this call, so the cost is small and lands in the right place.
 */
async function getPublic<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "data" in body) {
      return (body as { data: T }).data;
    }
    return null;
  } catch {
    // A published page that cannot reach the API should render its own "not
    // available" state, not a 500 — the note may simply have been unpublished.
    return null;
  }
}

export function fetchPublicSite(slug: string): Promise<PublicSiteData | null> {
  return getPublic<PublicSiteData>(`/public/sites/${encodeURIComponent(slug)}`);
}

export function fetchPublicSiteNote(slug: string, path: string): Promise<PublicSiteNote | null> {
  return getPublic<PublicSiteNote>(
    `/public/sites/${encodeURIComponent(slug)}/note?path=${encodeURIComponent(path)}`,
  );
}

export function fetchPublicNote(token: string): Promise<PublicNote | null> {
  return getPublic<PublicNote>(`/public/${encodeURIComponent(token)}`);
}

/**
 * First ~25 words of a note's body, cleaned of markdown, for use as a meta
 * description. Truncated on a word boundary so the snippet does not end
 * mid-word — search engines rewrite descriptions freely, but a clean one is
 * far more likely to be used as written.
 */
export function excerpt(markdown: string, maxChars = 155): string {
  const text = markdown
    // Drop frontmatter, code fences and images before anything else.
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Keep the words inside links and wikilinks, drop the syntax.
    .replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : cut.length).trimEnd()}…`;
}
