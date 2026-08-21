import { NextResponse, type NextRequest } from "next/server";

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
 * - Everything else rewrites into the section (docs.x/mcp → /docs/mcp) —
 *   except app paths (/login, /vault, …), which pass through untouched so
 *   the chrome's links keep working anywhere.
 *
 * The apex serves every path as before; only with
 * NODUM_ENABLE_SUBDOMAIN_REDIRECTS set (production, DNS in place) does it
 * push section paths out to their subdomains.
 *
 * Works on *.localhost in development — browsers resolve it natively.
 */

const SECTIONS: Record<string, { prefix: string; exact?: boolean }> = {
  docs: { prefix: "/docs" },
  developers: { prefix: "/api-reference", exact: true },
  community: { prefix: "/community", exact: true },
  forum: { prefix: "/forum" },
};

/** Paths that belong to the app shell, never to a section. */
const PASS_THROUGH = ["/login", "/signup", "/vault", "/p/", "/s/", "/clip", "/llms.txt"];

function sectionOfPath(pathname: string): string | null {
  for (const [sub, { prefix }] of Object.entries(SECTIONS)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return sub;
  }
  return null;
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
  const proto = forwardedProto ? `${forwardedProto}:` : request.nextUrl.protocol;

  if (section) {
    const apexHost = rest.join(".");
    const { prefix, exact } = SECTIONS[section];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const rooted = pathname.slice(prefix.length) || "/";
      return hostRedirect(`${proto}//${host}${rooted}${search}`, 308);
    }
    const other = sectionOfPath(pathname);
    if (other && other !== section) {
      const otherPrefix = SECTIONS[other].prefix;
      const rooted = pathname.slice(otherPrefix.length) || "/";
      return hostRedirect(`${proto}//${other}.${apexHost}${rooted}${search}`, 307);
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

  if (process.env.NODUM_ENABLE_SUBDOMAIN_REDIRECTS) {
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
