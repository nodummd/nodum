import { SITE_URL } from "@/lib/seo/site";

/**
 * robots.txt — a route handler rather than the typed `robots.ts` convention,
 * because the metadata API cannot emit `Content-Signal`, and the file is
 * clearer written the way RFC 9309 reads: one group per policy, with every
 * agent that shares the policy listed at its head.
 *
 * ## The AI-crawler decision
 *
 * A publisher with an ad-funded archive has a reason to block GPTBot and
 * friends: the model reads the article and the reader never arrives. Nodum has
 * the opposite incentive. It is MIT-licensed software whose growth problem is
 * *being known about*, and the answer to "what is a good open-source Obsidian
 * alternative?" is now given by a model far more often than by a list of ten
 * blue links. Being in the training corpus and being citable in an answer are
 * both distribution, so every family is allowed — search indexers,
 * user-triggered fetchers and training crawlers alike.
 *
 * Tokens are the ones each vendor documents as of September 2026. Googlebot
 * and bingbot need no entry: Google's AI Overviews / AI Mode and Microsoft
 * Copilot are grounded on the ordinary search crawl, which `*` already covers.
 * `anthropic-ai` is no longer in Anthropic's docs; it stays because naming a
 * retired token costs nothing and an old crawler may still send it.
 *
 * `Content-Signal` (Cloudflare's content-signals policy) states the same
 * decision in machine-readable form: yes to search, yes to use as AI input,
 * yes to training. Crawlers that do not know the line ignore it.
 *
 * Bytespider is the one exclusion. It is repeatedly documented ignoring
 * disallow rules; the rule states the intent even where it is not honoured.
 *
 * Everything private is excluded from every agent: the workspace itself
 * (`/vault`), the clipper hand-off, the API, and `/p/` capability links, which
 * are unlisted by design. Published vault sites (`/s/`) are deliberately *not*
 * excluded — a user who publishes a site means it to be read.
 */

const AI_AGENTS = [
  // OpenAI — search index, user-triggered fetch, training
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  // Anthropic
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "anthropic-ai",
  // Google — Gemini grounding/training token, Vertex AI agents
  "Google-Extended",
  "Google-CloudVertexBot",
  // Apple — Siri/Spotlight crawl, and the training-use token
  "Applebot",
  "Applebot-Extended",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Meta — AI search index, user fetches, training
  "meta-webindexer",
  "meta-externalfetcher",
  "meta-externalagent",
  // Amazon — Alexa/Rufus search, user fetches, training
  "Amzn-SearchBot",
  "Amzn-User",
  "Amazonbot",
  // Mistral
  "MistralAI-User",
  "MistralAI-Index",
  "MistralAI-Training",
  // The rest of the field
  "DuckAssistBot",
  "YouBot",
  "cohere-ai",
  "Diffbot",
  "CCBot",
];

/** Not for crawlers of any kind: the app, the API, and unlisted links. */
const PRIVATE_PATHS = ["/api/", "/vault", "/clip", "/p/"];

export const dynamic = "force-static";

function buildRobots(siteUrl = SITE_URL): string {
  const rules = ["Allow: /", ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)];
  const lines = [
    "# Nodum — open-source knowledge base. Search, answer and training crawlers are welcome.",
    "# The public content index for agents: " + `${siteUrl}/llms.txt`,
    "",
    "User-Agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    ...rules,
    "",
    ...AI_AGENTS.map((agent) => `User-Agent: ${agent}`),
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    ...rules,
    "",
    "User-Agent: Bytespider",
    "Disallow: /",
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
  ];
  return lines.join("\n");
}

export function GET() {
  return new Response(buildRobots(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
