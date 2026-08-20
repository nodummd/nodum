import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";

import { JsonLd } from "@/components/seo/json-ld";
import { APP_VERSION } from "@/lib/app-meta";
import * as ld from "@/lib/seo/jsonld";

import "./marketing.css";

/**
 * The features that define the entity, in the words a person would search
 * with. This is the `featureList` on the SoftwareApplication node — the fact
 * table an answer engine reads when asked "does it do X?".
 */
const FEATURES = [
  "Markdown notes with live preview (CodeMirror 6)",
  "[[Wikilinks]] with autocomplete, aliases, heading targets and embeds",
  "Automatic backlinks with context, plus unlinked mentions",
  "GPU-rendered knowledge graph, global and local (WebGL2)",
  "Obsidian vault import and export as a folder-true zip",
  "Full-text search with path:, file: and tag: operators",
  "Nested tags, YAML frontmatter properties, daily notes and templates",
  "Real-time collaborative editing with presence (Yjs CRDT)",
  "Public note links and whole-vault published sites",
  "Server-side version history on every save",
  "AI assistant on your own API key (Claude, OpenAI, Gemini, Qwen)",
  "Model Context Protocol server with 36 tools",
  "Web clipper (Chrome MV3) with scoped, revocable tokens",
  "Canvas boards, KaTeX maths, Mermaid diagrams, callouts",
  "Self-hostable with one Docker Compose command",
];

/** Display face for the wordmark and headlines — engineered, slightly odd,
 *  and nothing like the workspace's system UI font. Used big and sparingly. */
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

/** Body face: quiet, wide apertures, holds up at 15px on a black page. */
const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Everything outside the app itself: the landing page, the auth pages, the
 * docs and the editorial cluster. They share one skin (marketing.css), one
 * type pairing, and one declaration of who and what this is.
 *
 * The three identity nodes are declared exactly once, here, and referenced by
 * `@id` from every page beneath. That is deliberate: an entity graph is only
 * worth building if the sixty pages on this domain resolve to *one*
 * organisation and *one* piece of software rather than sixty unrelated copies
 * of the same claims. It sits on this layout rather than the root so the
 * workspace — which is noindex anyway — does not carry the payload.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-marketing className={`${display.variable} ${body.variable} min-h-screen`}>
      <JsonLd
        data={ld.graph(
          ld.organization(),
          ld.website(),
          ld.softwareApplication({ version: APP_VERSION, features: FEATURES }),
        )}
      />
      {children}
    </div>
  );
}
