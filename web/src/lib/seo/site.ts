/**
 * One place for every absolute URL, brand string and identity claim the site
 * emits. Metadata, JSON-LD, the sitemap, robots.txt and llms.txt all read from
 * here, so a deployment on another domain only has to set NEXT_PUBLIC_SITE_URL
 * and every canonical, `sameAs` and sitemap entry follows.
 */

/** No trailing slash, ever — every helper below concatenates onto it. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nodum.md").replace(/\/+$/, "");

export const SITE_NAME = "Nodum";
export const SITE_TAGLINE = "Notes are the knots";
export const GITHUB_URL = "https://github.com/nodummd/nodum";
export const GITHUB_ORG_URL = "https://github.com/nodummd";
export const LICENSE = "MIT";
export const LICENSE_URL = "https://opensource.org/licenses/MIT";

/** 1200×630, the card every network wants. Lives in `web/public/`. */
export const OG_IMAGE = "/og.jpg";
export const LOGO_PATH = "/logo.png";

/**
 * The one-sentence answer to "what is Nodum?". AI engines lift a passage of
 * roughly this length verbatim, so it is written to stand alone: entity,
 * category, licence, and the features that distinguish it.
 */
export const SITE_DESCRIPTION =
  "Nodum is a free, open-source, web-based knowledge base — an Obsidian alternative that runs in the browser. Write markdown notes, connect them with [[wikilinks]], get backlinks automatically, and explore everything you know as a GPU-rendered knowledge graph. MIT licensed and self-hostable in one command.";

/** The same claim, trimmed to fit a meta description (~155 characters). */
export const SITE_META_DESCRIPTION =
  "Free, open-source Obsidian alternative in your browser. Markdown notes, [[wikilinks]], backlinks and a live knowledge graph. MIT licensed, self-hostable.";

/**
 * `sameAs` for the Organization node. Deliberately short: an entity graph is
 * only useful if every profile in it is real and controlled by the project.
 * Add profiles here as they are actually claimed, never speculatively.
 */
export const SOCIAL_PROFILES = [GITHUB_URL, GITHUB_ORG_URL];

/** Absolute URL for a site-relative path, safe to hand to a crawler. */
export function absolute(path = "/"): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Stable `@id`s so every JSON-LD node on the site refers to the *same*
 * organisation, website and software entity rather than redeclaring them.
 * Entity consolidation is most of what makes a knowledge-graph entry stick.
 */
export const ID = {
  organization: `${SITE_URL}/#organization`,
  website: `${SITE_URL}/#website`,
  software: `${SITE_URL}/#software`,
} as const;
