import type { NextConfig } from "next";

// Same-origin proxy to the FastAPI backend: the browser only ever talks to
// the Next.js origin, so the httpOnly refresh cookie is first-party and no
// CORS is involved. Docker prod sets API_PROXY_URL=http://api:8000.
const API_PROXY_URL = process.env.API_PROXY_URL ?? "http://localhost:8000";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nodum.md").replace(/\/+$/, "");

/**
 * Permanent redirects for URLs people type or link without checking.
 *
 * None of these ever existed, and a redirect does not rank — the canonical
 * page does. What they buy is that an inbound link someone wrote from memory
 * lands on the page instead of a 404, which is worth six lines of config.
 * "obsidian-alternative" in particular is the shape people guess.
 */
const KEYWORD_ALIASES: { from: string; to: string }[] = [
  { from: "/obsidian-alternative", to: "/alternatives/obsidian" },
  { from: "/obsidian", to: "/alternatives/obsidian" },
  { from: "/notion-alternative", to: "/alternatives/notion" },
  { from: "/evernote-alternative", to: "/alternatives/evernote" },
  { from: "/logseq-alternative", to: "/alternatives/logseq" },
  { from: "/roam-alternative", to: "/alternatives/roam-research" },
  { from: "/compare", to: "/alternatives" },
  { from: "/vs", to: "/alternatives" },
  { from: "/second-brain", to: "/learn/second-brain" },
  { from: "/ai-notes", to: "/learn/ai-note-taking" },
  { from: "/ai-note-taking", to: "/learn/ai-note-taking" },
  { from: "/open-source", to: "/learn/open-source-note-taking" },
  { from: "/self-hosted", to: "/learn/self-hosted-notes" },
  { from: "/zettelkasten", to: "/learn/zettelkasten" },
  { from: "/knowledge-graph", to: "/learn/knowledge-graph" },
  { from: "/pkm", to: "/learn/personal-knowledge-management" },
  { from: "/guides", to: "/learn" },
  { from: "/help", to: "/docs" },
];

const nextConfig: NextConfig = {
  // Standalone server bundle for slim Docker images (see docker/Dockerfile)
  output: "standalone",
  // The floating dev indicator overlays the ribbon and intercepts clicks
  // (breaks e2e and manual testing); errors still surface in the console.
  devIndicators: false,
  // One fewer header advertising the framework version to a scanner.
  poweredByHeader: false,
  rewrites() {
    return Promise.resolve([
      { source: "/api/:path*", destination: `${API_PROXY_URL}/api/:path*` },
    ]);
  },
  redirects() {
    return Promise.resolve(
      KEYWORD_ALIASES.map(({ from, to }) => ({ source: from, destination: to, permanent: true })),
    );
  },
  headers() {
    return Promise.resolve([
      {
        // The llms.txt specification's HTTP-header form of the same signal the
        // root layout emits as a <link>. An agent that issues a HEAD request,
        // or that never parses the HTML, still finds the curated index.
        source: "/:path*",
        headers: [
          {
            key: "Link",
            value: `<${SITE_URL}/llms.txt>; rel="describedby"; type="text/markdown"`,
          },
        ],
      },
      {
        // Generated from content at build time and cheap to regenerate, but
        // fetched by crawlers far more often than it changes.
        source: "/:file(robots.txt|sitemap.xml|llms.txt|llms-full.txt)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
