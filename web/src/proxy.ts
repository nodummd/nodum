import { NextResponse, type NextRequest } from "next/server";

import { SITE_URL } from "@/lib/seo/site";
import { APEX_ONLY, SECTIONS, SUBDOMAINS_ENABLED, matchesPrefix, sectionOfPath } from "@/lib/sections";

/**
 * Host-based sections: docs.<domain>, developers.<domain>, community.<domain>
 * and forum.<domain> serve their section at the root, backed by the same app.
 *
 * Rules on a section host:
 * - Its own prefixed path canonicalizes to the rooted form (docs.x/docs/mcp
 *   308→ docs.x/mcp).
 * - Another section's path 307s to THAT section's host, rooted (forum.x/docs/
 *   mcp → docs.x/mcp). Never to the apex: this Next relativizes Location
 *   headers that match its own origin, and a relative Location on a foreign
 *   host would loop.
 * - An apex-only marketing page (/alternatives, /learn, …) 308s to the apex:
 *   the shared footer links to them from every host, and rewritten into the
 *   section they 404.
 * - Everything else rewrites into the section (docs.x/mcp → /docs/mcp) —
 *   except app paths (/login, /vault, …), which pass through untouched so
 *   the chrome's links keep working anywhere.
 *
 * The apex serves every path as before; only with
 * NODUM_ENABLE_SUBDOMAIN_REDIRECTS set (production, DNS in place) does it
 * push section paths out to their subdomains.
 *
 * www.<domain> 308s to the apex, so the site has one host per page.
 *
 * Works on *.localhost in development — browsers resolve it natively.
 */

/** Paths that belong to the app shell, never to a section. */
const PASS_THROUGH = ["/login", "/signup", "/vault", "/p/", "/s/", "/clip", "/llms.txt"];

const SITE = new URL(SITE_URL);

/**
 * The scheme to put in a redirect. The container only ever sees http, and the
 * X-Forwarded-Proto it gets is whatever the proxy in front of it spoke — which
 * behind a second TLS-terminating hop is http too. Production 308s were
 * sending crawlers to http://docs.nodum.md, one wasted hop (and a mixed
 * signal) on every section URL. The site's own hosts are https whenever
 * SITE_URL says so; anything else (*.localhost) trusts the request.
 */
function publicProto(host: string, fallback: string): string {
  const bare = host.split(":")[0];
  const ours = bare === SITE.hostname || bare.endsWith(`.${SITE.hostname}`);
  return ours && SITE.protocol === "https:" ? "https:" : fallback;
}

/** An absolute-Location redirect Next cannot relativize. */
function hostRedirect(url: string, status: 307 | 308) {
  return new NextResponse(null, { status, headers: { Location: url } });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const [first, ...rest] = host.split(".");
  const section = SECTIONS[first] && rest.length > 0 ? first : null;
  const { pathname, search } = request.nextUrl;
  // Behind the TLS-terminating proxy the container only ever sees http —
  // redirects must use the protocol the CLIENT used, or https pages bounce
  // to http:// URLs.
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = publicProto(host, forwardedProto ? `${forwardedProto}:` : request.nextUrl.protocol);

  if (first === "www" && rest.join(".") === SITE.host) {
    return hostRedirect(`${proto}//${SITE.host}${pathname}${search}`, 308);
  }

  if (section) {
    const apexHost = rest.join(".");
    const { prefix, exact } = SECTIONS[section];
    if (matchesPrefix(pathname, prefix)) {
      const rooted = pathname.slice(prefix.length) || "/";
      return hostRedirect(`${proto}//${host}${rooted}${search}`, 308);
    }
    const other = sectionOfPath(pathname);
    if (other && other !== section) {
      const otherPrefix = SECTIONS[other].prefix;
      const rooted = pathname.slice(otherPrefix.length) || "/";
      return hostRedirect(`${proto}//${other}.${apexHost}${rooted}${search}`, 307);
    }
    if (APEX_ONLY.some((p) => matchesPrefix(pathname, p))) {
      // In development the apex IS this server's own origin (localhost:3100),
      // so Next would relativize the Location and the section host would
      // redirect to itself forever. Serve the page in place there instead;
      // its canonical still names the apex.
      if (apexHost.split(":")[0] === "localhost") return NextResponse.next();
      return hostRedirect(`${proto}//${apexHost}${pathname}${search}`, 308);
    }
    if (PASS_THROUGH.some((p) => pathname === p || pathname.startsWith(p))) {
      return NextResponse.next();
    }
    if (exact && pathname !== "/") {
      // Sections without subpaths: serve the apex's page under this host
      // rather than redirect (an apex-target Location would relativize).
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? prefix : `${prefix}${pathname}`;
    return NextResponse.rewrite(url);
  }

  if (SUBDOMAINS_ENABLED) {
    const target = sectionOfPath(pathname);
    if (target) {
      const { prefix } = SECTIONS[target];
      const rooted = pathname.slice(prefix.length) || "/";
      return hostRedirect(`${proto}//${target}.${host}${rooted}${search}`, 308);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|_next/data|favicon.ico|.*\\..*).*)"],
};
