import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo/site";

/**
 * robots.txt — served at /robots.txt by the App Router.
 *
 * ## The AI-crawler decision
 *
 * A publisher with an ad-funded archive has a reason to block GPTBot and
 * friends: the model reads the article and the reader never arrives. Nodum has
 * the opposite incentive. It is MIT-licensed software whose growth problem is
 * *being known about*, and the answer to "what is a good open-source Obsidian
 * alternative?" is now given by a model far more often than by a list of ten
 * blue links. Being in the training corpus and being citable in an answer are
 * both distribution, so both families are allowed:
 *
 *   - answer/search agents — OAI-SearchBot, ChatGPT-User, PerplexityBot,
 *     Perplexity-User, Claude-SearchBot, Claude-User, Google-Extended,
 *     Applebot-Extended, Meta-ExternalAgent, Amazonbot, DuckAssistBot,
 *     cohere-ai, MistralAI-User, YouBot, Diffbot
 *   - training crawlers — GPTBot, ClaudeBot, anthropic-ai, CCBot
 *
 * Bytespider is the one exclusion. It is the single largest source of AI
 * crawler traffic and is repeatedly documented ignoring disallow rules; the
 * rule below costs nothing and states the intent even where it is not honoured.
 *
 * Everything private is excluded from every agent by the wildcard group:
 * the workspace itself (`/vault`), the clipper hand-off, the API proxy, and
 * `/p/` capability links, which are unlisted by design. Published vault sites
 * (`/s/`) are deliberately *not* excluded — a user who publishes a site means
 * it to be read.
 */

/** Agents that get the same access as Googlebot, listed for legibility. */
const AI_AGENTS = [
  // OpenAI
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  // Google / Apple gated corpora
  "Google-Extended",
  "Applebot-Extended",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // The rest of the field
  "Meta-ExternalAgent",
  "Amazonbot",
  "DuckAssistBot",
  "cohere-ai",
  "MistralAI-User",
  "YouBot",
  "Diffbot",
  "CCBot",
];

/** Not for crawlers of any kind: the app, the API, and unlisted links. */
const PRIVATE_PATHS = ["/api/", "/vault", "/vault/", "/clip", "/p/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      ...AI_AGENTS.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE_PATHS })),
      { userAgent: "Bytespider", disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
