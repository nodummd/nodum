# Goal — Search and answer-engine visibility (SEO + GEO)

> Branch: `feature/1.seo-geo_maqbool_200820262350`, cut from `dev`.
> Status: **complete**, `make verify` green, 18 new e2e assertions passing.

## Why

Nodum's growth problem is not the product, it is that nobody knows the product
exists. Two audiences decide that, and in 2026 they are no longer the same one:

1. **Search engines**, which rank pages.
2. **Generative engines** — Google AI Overviews and AI Mode, ChatGPT Search,
   Perplexity, Claude, Copilot — which *answer* the question and cite two to
   seven domains while doing it.

The second increasingly precedes the first: someone asking "what's a good
open-source Obsidian alternative?" now reads a paragraph, not ten blue links.
Optimising for one without the other leaves half the distribution on the floor.

## Target intents

The head terms this work is meant to win, and the page that owns each:

| Intent | Owner |
|---|---|
| `nodum`, `nodum md`, brand | `/`, `/faq` |
| `obsidian alternative`, `open source alternative for obsidian`, `obsidian web version` | `/alternatives/obsidian` |
| `obsidian publish alternative` | `/alternatives/obsidian-publish` |
| `notion / evernote / logseq / roam / onenote / … alternative` | `/alternatives/<slug>` (18 pages) |
| `second brain`, `second brain app`, `digital brain`, `brain app` | `/learn/second-brain` |
| `ai brain`, `ai note taking app`, `best ai note making tool`, `ai link notes` | `/learn/ai-note-taking` |
| `open source note making tool`, `open source note taking app` | `/learn/open-source-note-taking` |
| `note making tool`, `best note taking app` | `/learn/note-taking-app` |
| `knowledge graph`, `node based note taking` | `/learn/knowledge-graph` |
| `wikilinks`, `backlinks`, `bidirectional links` | `/learn/backlinks` |
| `zettelkasten app`, `pkm`, `self hosted notes`, `markdown notes app` | `/learn/*` |
| Vocabulary / entity coverage (36 terms) | `/glossary` |

Full keyword map: `web/src/lib/seo/keywords.ts`.

## What was built

### 1. The technical floor (none of this existed)

- **`app/robots.ts`** — the AI-crawler policy, argued in the file. Both the
  training crawlers (GPTBot, ClaudeBot, CCBot) and the answer agents
  (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot,
  Google-Extended, Applebot-Extended, and nine more) get the same access as
  Googlebot, because for MIT-licensed software both are distribution.
  Bytespider is the single exclusion. `/api/`, `/vault`, `/clip` and `/p/` are
  disallowed for everyone; `/s/` deliberately is not.
- **`app/sitemap.ts`** — generated from the content model, 57 URLs.
  `lastModified` is set only where a real date exists, because Google discards
  a lastmod that is always today.
- **Canonical URLs on every public page**, via a `pageMetadata()` factory that
  makes one impossible to forget — and deliberately *not* on the root layout,
  where an inherited canonical would collapse the whole site onto `/`.
- **`max-snippet:-1` / `max-image-preview:large`** everywhere, so an engine may
  quote a full passage instead of a 160-character stub.
- **`viewport` export**, `poweredByHeader: false`, 18 keyword-alias redirects.
- **`noindex` on `/vault` and `/clip`** via layouts, since those pages are
  client components and cannot export metadata. robots.txt stops the crawl;
  the meta tag stops the URL-only listing.

### 2. Structured data (`src/lib/seo/jsonld.ts`)

Organization, WebSite (with SearchAction), SoftwareApplication, WebPage,
TechArticle, Article, BreadcrumbList, FAQPage, HowTo, ItemList, DefinedTermSet,
DefinedTerm, and a `comparedApplication` node so a competitor named on a
comparison page is a real entity rather than loose prose.

The identity nodes are declared **once**, in the marketing layout, and
referenced by `@id` everywhere else. Sixty pages resolving to one organisation
and one application is the difference between a knowledge-graph entry and sixty
unrelated copies of the same claims. `offers.price: 0` is deliberate: "is it
free?" is the highest-volume qualifier in this category.

### 3. GEO: `/llms.txt` and `/llms-full.txt`

Both generated from the same content modules the pages render, so they cannot
drift. `/llms.txt` follows the specification (H1 → blockquote → H2 link
sections) and includes a paragraph stating what Nodum **does not** do — no
Obsidian plugins, no offline mode, no flashcards, no Notion databases, no block
references — because a model that knows what is absent will not invent it.
`/llms-full.txt` is the whole corpus as one 154 KB markdown document.
Advertised by `<link rel="describedby">` and an HTTP `Link:` header.

### 4. The content, which is what actually ranks

- **18 comparison pages** (`/alternatives/*`). Every one commits to a list of
  what the *other* tool does better, a structural facts table (licence,
  hosting, storage format, link syntax, graph, pricing model, platforms,
  export), who should switch, who should **not**, a migration path where one
  exists, and FAQs. Facts verified August 2026 and stamped on the page.
- **10 concept pages** (`/learn/*`) plus a hub. Written to be worth reading if
  Nodum did not exist; the product appears as one implementation among several.
- **`/glossary`** — 36 terms on one page, not 36 thin pages. Entity coverage
  without the shape Google spent 2026 deindexing.
- **`/faq`** — 22 questions including the ones answered "no".
- Landing page gained a comparison/concept link block and a featured FAQ, and
  the footer became a real four-column map so nothing is more than two clicks
  from anything.

Structural honesty is not decoration here: it is the defence against the March
and May 2026 core updates, which removed template-built comparison pages at
scale. Every page carries information a reader cannot get from the vendor.

### 5. Bugs found and fixed on the way

- **Published pages were invisible to search.** `/s/[slug]`, `/s/[slug]/[...path]`
  and `/p/[token]` fetched their content in the browser, so the HTML a crawler
  or a link unfurler received said "Loading…". All three are now server
  components; content, per-note titles, descriptions and Open Graph cards are
  in the initial response. Published sites are indexable; `/p/` token links are
  `noindex, follow` — publishing a vault is "this is public", an unlisted share
  link is not.
- **`/docs` rendered as "Documentation · Nodum · Nodum".** A `title` string on
  the docs layout collided with the root template — and, worse, consumed the
  template for its descendants. Titles moved to pages.
- **The landing page was a client component** for one `useEffect` redirect,
  shipping the whole tree as client JS. The redirect is now a six-line island.
- **A root-level dynamic route broke a lint rule repo-wide.** `/second-brain`
  et al. sat at the top level first; with `app/[topic]` present,
  `no-html-link-for-pages` treats every internal `<a href>` as a page link.
  Moved under `/learn/`.
- **`no-store` on the public fetches.** The first version cached them for five
  minutes, which would have kept an unpublished note readable for that long.

## Verification

- `make verify` — green (ruff, 60 backend unit tests, typecheck, image-check,
  lint, build).
- `web/e2e/seo.spec.ts` — 18 assertions: robots policy, sitemap validity and
  exclusions, llms.txt shape, canonical correctness per page, title uniqueness
  and brand non-duplication, noindex on app routes, JSON-LD parsed and typed,
  answer-block word counts, single `h1`, cluster interlinking, alias redirects.
  Several read the raw HTTP response rather than the DOM, because "present
  after hydration" is not what a crawler receives.
- `publish.spec.ts` and `vault-site.spec.ts` extended with crawler-view
  assertions and verified against a live API.

## What still needs a human

- Claim Google Search Console and Bing Webmaster Tools, then set
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` / `NEXT_PUBLIC_BING_SITE_VERIFICATION`
  (already wired) and submit `https://nodum.md/sitemap.xml`.
- Off-site is where the remaining leverage is and code cannot do it: AI engines
  weight third-party mentions far above owned content, and Reddit, Wikipedia,
  GitHub and Hacker News dominate citations in this category. A GitHub README
  that matches the site's claims, an `openalternative.co` / `alternativeto.net`
  listing, and honest participation in r/ObsidianMD and r/PKMS are worth more
  than any further on-site work.
- Re-verify the comparison facts each quarter and move `CHECKED` in
  `web/src/content/seo/alternatives.ts`. The date is rendered on every page.
