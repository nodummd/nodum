/**
 * Host-based sections — docs.<domain>, developers.<domain>, community.<domain>
 * and forum.<domain> — shared by the request proxy (which routes them) and the
 * SEO layer (which must name the URL a page is *actually* served at).
 *
 * The two used to disagree: with subdomains on, nodum.md/docs/mcp 308s to
 * docs.nodum.md/mcp, yet every docs page declared the apex URL as canonical and
 * the sitemap listed it. A canonical that points at a redirect is a conflicting
 * signal, and Google resolves it by trusting neither.
 */

export const SECTIONS: Record<string, { prefix: string; exact?: boolean }> = {
  docs: { prefix: "/docs" },
  developers: { prefix: "/api-reference", exact: true },
  community: { prefix: "/community", exact: true },
  forum: { prefix: "/forum" },
};

/**
 * Marketing pages that live only on the apex. A section host that receives one
 * — a footer link followed from forum.<domain> — sends it to the apex instead
 * of rewriting it into the section, where it would 404.
 */
export const APEX_ONLY = ["/alternatives", "/learn", "/glossary", "/faq", "/privacy", "/terms"];

/**
 * Set in production once DNS for the subdomains exists. Read at build time by
 * the statically rendered pages (their canonicals are baked in), and at run
 * time by the proxy — so the web image needs it in both places.
 */
export const SUBDOMAINS_ENABLED = Boolean(process.env.NODUM_ENABLE_SUBDOMAIN_REDIRECTS);

export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function sectionOfPath(pathname: string): string | null {
  for (const [sub, { prefix }] of Object.entries(SECTIONS)) {
    if (matchesPrefix(pathname, prefix)) return sub;
  }
  return null;
}

/**
 * The public URL for an apex-relative path: `/docs/mcp` becomes
 * `https://docs.<domain>/mcp` when subdomains are on, and stays on the apex
 * otherwise. `siteUrl` has no trailing slash.
 */
export function publicUrl(siteUrl: string, path: string): string {
  const [pathname, rest = ""] = splitPath(path);
  const section = SUBDOMAINS_ENABLED ? sectionOfPath(pathname) : null;
  if (!section) return `${siteUrl}${path}`;
  const origin = new URL(siteUrl);
  const rooted = pathname.slice(SECTIONS[section].prefix.length) || "/";
  return `${origin.protocol}//${section}.${origin.host}${rooted}${rest}`;
}

/** `/a/b?x#y` → [`/a/b`, `?x#y`]. */
function splitPath(path: string): [string, string] {
  const cut = path.search(/[?#]/);
  return cut === -1 ? [path, ""] : [path.slice(0, cut), path.slice(cut)];
}
