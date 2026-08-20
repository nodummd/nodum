import type { Faq } from "@/lib/seo/jsonld";

/**
 * The /alternatives cluster.
 *
 * Google spent 2026 deindexing template-built comparison pages, and it was
 * right to: most of them are a competitor's name pasted into a paragraph of
 * marketing. The defence is not to avoid the format — "X alternative" is a
 * genuine, high-intent query — but to make each entry carry information a
 * reader cannot get from the vendor's own site. Every entry below therefore
 * commits to four things that cost something to write:
 *
 *   1. `theyWin` — a real list of things the other tool does better. A
 *      comparison page with no losses is an advert, and both readers and
 *      language models discount it accordingly.
 *   2. `facts` — structural claims (licence, storage format, link syntax,
 *      export path) that are checkable and that do not rot the way prices do.
 *   3. `stayIf` — the reader we tell to *not* switch.
 *   4. `answer` — a self-contained 40–60 word paragraph that answers the query
 *      without needing the rest of the page, because that is the unit an AI
 *      engine quotes.
 *
 * Facts were checked in August 2026; `CHECKED` is rendered on every page so a
 * reader knows how fresh the claim is.
 */

export const CHECKED = "2026-08-20";

export interface AlternativeFacts {
  /** Licence, or "Proprietary" — the fact this whole cluster turns on. */
  license: string;
  /** Where the software runs and who operates it. */
  hosting: string;
  /** What your notes physically are when the company disappears. */
  storage: string;
  /** How one note points at another. */
  linking: string;
  /** Graph view: what kind, or none. */
  graph: string;
  /** The shape of the pricing, not the price — prices rot, models don't. */
  pricing: string;
  platforms: string;
  /** Getting your data back out. */
  export: string;
}

export interface Alternative {
  slug: string;
  /** Product name exactly as its makers write it. */
  name: string;
  /** Official site, for the `sameAs`/`url` on the compared-application node. */
  url: string;
  /** H1. Written as the answer to the query, not as a slogan. */
  headline: string;
  /**
   * The `<title>`, which is a different job from the H1 and has a hard budget:
   * a search result shows roughly 60 characters, and the site template adds
   * " · Nodum" to whatever goes here. So the H1 gets to be a full sentence
   * and this gets the competitor's name first and about forty characters to
   * say why. Falls back to `headline` if absent, but every entry sets it.
   */
  metaTitle?: string;
  /** Meta description, ~155 characters, a complete sentence. */
  description: string;
  /** The opening answer block: 40–60 words, quotable on its own. */
  answer: string;
  keywords: string[];
  /** Two or three sentences on what the other tool actually is. Fair. */
  what: string;
  facts: AlternativeFacts;
  /** Honest. If this list is weak the page is not worth publishing. */
  theyWin: string[];
  weWin: string[];
  switchIf: string[];
  stayIf: string[];
  /** Concrete migration path, when one exists. Powers HowTo schema. */
  migration?: { steps: { name: string; text: string }[]; note?: string };
  faqs: Faq[];
  /** Ordering on the hub page — lower is more prominent. */
  rank: number;
}

/** Nodum's own column in every comparison table. One definition, reused. */
export const NODUM_FACTS: AlternativeFacts = {
  license: "MIT — the whole stack, frontend and backend",
  hosting: "Hosted at nodum.md, or self-hosted with one Docker Compose command",
  storage: "Plain markdown files, exported as a folder-true zip whenever you ask",
  linking: "[[wikilinks]], [[path/Note]], [[Note|alias]], ![[embeds]] — Obsidian syntax",
  graph: "Global and local force-directed graph, GPU-rendered on WebGL2",
  pricing: "Free and open source; self-host at your own infrastructure cost",
  platforms: "Any modern browser, desktop and mobile; installable as a PWA",
  export: "Vault zip of .md files, plus a REST API and an MCP server",
};

export const ALTERNATIVES: Alternative[] = [
  {
    slug: "obsidian",
    name: "Obsidian",
    url: "https://obsidian.md",
    rank: 1,
    metaTitle: "Obsidian alternative — open source, runs in your browser",
    headline: "The open-source Obsidian alternative that runs in your browser",
    description:
      "Nodum is a free, MIT-licensed Obsidian alternative for the web: same [[wikilinks]], same backlinks, same graph — no install, and you can read the source.",
    answer:
      "Nodum is an open-source alternative to Obsidian that runs in a browser instead of as a desktop app. It uses the same wikilink syntax, the same backlinks and the same plain-markdown files, adds a GPU-rendered knowledge graph, and is MIT licensed — so you can read every line, self-host it, and export your vault as ordinary .md files at any time.",
    keywords: [
      "obsidian alternative",
      "open source obsidian alternative",
      "open source alternative for obsidian",
      "obsidian web version",
      "obsidian online",
      "obsidian in browser",
      "free obsidian alternative",
      "is obsidian open source",
      "web based obsidian",
      "alternative to obsidian",
    ],
    what: "Obsidian is a local-first markdown knowledge base: a desktop and mobile app that reads a folder of plain .md files on your own disk, links them with [[wikilinks]], and draws the result as a graph. Its plugin ecosystem is the largest in this category by a wide margin, and the app itself is free. It is also closed-source — the vault format is open, the program is not — and it is not a web application, so a machine you cannot install software on is a machine you cannot use it on.",
    facts: {
      license: "Proprietary. The file format is open; the application is not",
      hosting: "Local-first desktop and mobile app; optional paid Sync service",
      storage: "Plain markdown files in a folder on your own disk",
      linking: "[[wikilinks]], aliases, embeds, block references, heading links",
      graph: "Global and local graph view, with groups and filters",
      pricing: "Free for personal and commercial use; Sync and Publish are paid add-ons",
      platforms: "macOS, Windows, Linux, iOS, Android — no browser version",
      export: "Nothing to export: the files are already yours, on your disk",
    },
    theyWin: [
      "A plugin ecosystem of well over a thousand community plugins, plus themes — nothing else in this category is close, and Nodum's sandboxed plugin API is deliberately narrower.",
      "It works with no network at all. Nodum needs a server it can reach, even if that server is a Raspberry Pi in your cupboard.",
      "Your notes are already files on your own disk, which is the strongest data-ownership story anyone can offer.",
      "Mature native mobile apps, offline editing included.",
      "Years of polish and a large community writing about workflows, templates and setups.",
    ],
    weWin: [
      "It is genuinely open source — MIT, frontend and backend — so you can audit it, fork it, or run it forever regardless of what the project does next.",
      "It runs in the browser. A locked-down work laptop, a Chromebook, a borrowed machine and a phone all get the same vault with nothing installed.",
      "Sync is not an add-on. The server is the vault, so every device is current by construction, with no subscription attached.",
      "Real-time collaborative editing on a note, with presence — Obsidian has no first-party equivalent.",
      "Publishing a vault as a public site is built in rather than a separate paid product.",
      "An MCP server with 36 tools, so Claude Code, Claude Desktop or Cursor can read and write your vault directly.",
      "An AI assistant that works on your vault using your own API key, encrypted at rest — no per-seat AI upsell.",
    ],
    switchIf: [
      "You want to open your notes on any machine, without installing anything.",
      "You care that the software itself is open source, not only the file format.",
      "You are paying for Sync, or Publish, and would rather run the whole thing yourself.",
      "You want two people editing one note at the same time.",
      "You want an AI assistant, or an MCP client, working directly against your notes.",
    ],
    stayIf: [
      "You depend on specific community plugins — Dataview, Templater, Excalidraw. That ecosystem is Obsidian's moat and Nodum does not replicate it.",
      "You work offline for long stretches, on a plane or in the field.",
      "You want your notes to exist as files on your own filesystem at all times, with no server in the picture.",
    ],
    migration: {
      steps: [
        {
          name: "Export your Obsidian vault",
          text: "Zip your vault folder exactly as it sits on disk. Keep the folder structure — Nodum resolves path-style wikilinks like [[projects/Note]] against it.",
        },
        {
          name: "Create a Nodum vault",
          text: "Sign up at nodum.md or start your own instance with ./compose.sh prod up -d --build, then create an empty vault.",
        },
        {
          name: "Import the zip",
          text: "Settings → Vault → Import. Nodum unwraps a redundant root folder, detects .obsidian config directories, and treats .md, .markdown and .txt as notes. PDFs come in as attachments plus a note of their extracted text.",
        },
        {
          name: "Check the links resolved",
          text: "Links are resolved across the whole import batch rather than file by file, so [[Note]] references to files later in the zip still land. Open the graph: anything still a ghost node was an unresolved link in Obsidian too.",
        },
        {
          name: "Keep your exit open",
          text: "Export the vault whenever you like and you get a folder-true zip of .md files back — the same thing you put in.",
        },
      ],
      note: "Nothing about the import is one-way. Nodum's export is Obsidian-compatible, so going back is the same operation in reverse.",
    },
    faqs: [
      {
        question: "Is Obsidian open source?",
        answer:
          "No. Obsidian is a proprietary, closed-source application. Its vault format is open — plain markdown files in a folder — but the program itself is not, and its source code is not published. Nodum is MIT licensed end to end, so both the format and the software are open.",
      },
      {
        question: "Is there a web version of Obsidian?",
        answer:
          "Obsidian has no official browser version; it ships as a desktop and mobile application. Nodum is a web-native knowledge base built on the same ideas — CodeMirror 6 editor, [[wikilink]] syntax, backlinks and a graph view — so it runs in any modern browser with nothing installed.",
      },
      {
        question: "Can I import my Obsidian vault into Nodum?",
        answer:
          "Yes. Zip your vault folder and import it from Settings → Vault → Import. Nodum resolves wikilinks across the whole batch, handles nested folders and path-style links, recognises .obsidian config folders, and imports .md, .markdown and .txt files. Export gives you a folder-true zip of markdown back.",
      },
      {
        question: "Does Nodum support Obsidian plugins?",
        answer:
          "No, and the project says so plainly rather than implying otherwise. Obsidian plugins are written against Obsidian's own Node-level API; Nodum's plugin API is capability-scoped and runs inside an opaque-origin sandboxed iframe, which is a deliberately different and narrower contract. If a specific plugin is central to how you work, stay on Obsidian.",
      },
      {
        question: "Is Nodum free?",
        answer:
          "Yes. Nodum is free and open source under the MIT licence. You can use the hosted instance at nodum.md or run your own with one Docker Compose command, in which case your only cost is the server you run it on.",
      },
    ],
  },
  {
    slug: "obsidian-publish",
    name: "Obsidian Publish",
    url: "https://obsidian.md/publish",
    rank: 6,
    metaTitle: "Obsidian Publish alternative — free and open source",
    headline: "An open-source Obsidian Publish alternative — publishing built into the vault",
    description:
      "Publish a vault as a public site without a per-site subscription. Nodum has note links and whole-vault sites built in, MIT licensed and self-hostable.",
    answer:
      "Nodum is a free, open-source alternative to Obsidian Publish. Publishing is part of the app rather than a separate paid service: any note gets a public share link, and any vault can be published as a browsable public site with working links between notes. Self-host it and there is no per-site fee at all.",
    keywords: [
      "obsidian publish alternative",
      "publish obsidian notes free",
      "self hosted digital garden",
      "open source digital garden",
      "publish markdown notes website",
      "share obsidian notes online",
    ],
    what: "Obsidian Publish is a paid hosting add-on that turns selected notes from a vault into a public website on publish.obsidian.md or your own domain, billed per site per month. It is well made and genuinely low-effort — you pick notes, they appear online with the graph and backlinks intact.",
    facts: {
      license: "Proprietary, sold as a subscription add-on to Obsidian",
      hosting: "Hosted by Obsidian; custom domains supported",
      storage: "The published copy lives on Obsidian's servers",
      linking: "Wikilinks and backlinks are preserved on the published site",
      graph: "Interactive graph on the published site",
      pricing: "Per-site monthly subscription, billed separately from Sync",
      platforms: "Any browser, for readers",
      export: "The source vault stays on your disk",
    },
    theyWin: [
      "A genuinely polished reading experience with themes, custom domains and a published graph.",
      "It is one toggle away from a vault you already keep — no server to run.",
      "Search, backlinks and the graph all work on the public site out of the box.",
    ],
    weWin: [
      "Publishing is included, not a second subscription: every Nodum vault can become a public site at /s/your-slug.",
      "Individual notes get their own unlisted share link, revocable at any time.",
      "Published pages are server-rendered with real titles, descriptions and Open Graph cards, so they can be found and shared properly.",
      "Self-host it and publishing costs whatever your server costs and nothing more.",
      "The publishing code is MIT licensed, so what the reader sees is something you can change.",
    ],
    switchIf: [
      "You are paying per site and publishing more than one vault.",
      "You want the published site on infrastructure you control.",
      "You want a share link for a single note without publishing a whole site.",
    ],
    stayIf: [
      "You want custom themes and a custom domain with no server administration at all.",
      "Your notes live in Obsidian and you have no interest in moving the source of truth.",
    ],
    faqs: [
      {
        question: "Is there a free alternative to Obsidian Publish?",
        answer:
          "Yes. Nodum includes publishing at no cost: any note can be given a public share link, and any vault can be published as a public site with links between notes intact. Because Nodum is MIT licensed you can also self-host it, in which case publishing costs only the server you run.",
      },
      {
        question: "Can I publish only some notes rather than a whole vault?",
        answer:
          "Yes. Publishing in Nodum works at two levels: a per-note public link, which is unlisted and revocable, and a whole-vault public site at /s/your-slug. Use the per-note link when you want to share one page and nothing else.",
      },
    ],
  },
  {
    slug: "notion",
    name: "Notion",
    url: "https://www.notion.so",
    rank: 2,
    metaTitle: "Notion alternative — open source, markdown files",
    headline: "An open-source Notion alternative for people who want their notes as files",
    description:
      "Nodum is a free, open-source Notion alternative built on plain markdown, [[wikilinks]] and a knowledge graph — self-hostable, exportable, no per-seat pricing.",
    answer:
      "Nodum is an open-source alternative to Notion for personal knowledge work. Where Notion stores your writing as blocks in a hosted database, Nodum stores plain markdown files you can export as a folder at any time. It adds wikilinks, automatic backlinks and a knowledge graph, and it is MIT licensed and self-hostable.",
    keywords: [
      "notion alternative",
      "open source notion alternative",
      "self hosted notion alternative",
      "notion alternative free",
      "notion vs obsidian",
      "markdown notion alternative",
    ],
    what: "Notion is a hosted workspace built around blocks and databases: pages nest inside pages, and any collection of them can be viewed as a table, board, calendar or gallery. It is very strong as a team wiki and lightweight project tool, and its collaboration and permissions are excellent. Your content lives in Notion's database rather than as files, and while there is a markdown export, round-tripping a complex Notion workspace back out is famously lossy.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Notion's cloud only; no self-hosting",
      storage: "Blocks in a hosted database; markdown/HTML export is lossy",
      linking: "@-mentions and page links; relations between database rows",
      graph: "No graph view",
      pricing: "Free personal tier; per-seat monthly subscription for teams, AI billed on top",
      platforms: "Browser, desktop and mobile apps",
      export: "Markdown, HTML or CSV export — structure and database views do not survive intact",
    },
    theyWin: [
      "Databases. Tables, boards, calendars, relations and rollups have no equivalent in Nodum, and for project tracking they are the whole point.",
      "Team collaboration at organisation scale: granular permissions, guests, comments, shared workspaces.",
      "A very large template ecosystem and integrations with the rest of the SaaS world.",
      "A block editor that non-technical colleagues take to immediately.",
    ],
    weWin: [
      "Your notes are markdown files, not rows in someone else's database — export is a zip of .md, not a migration project.",
      "Open source under MIT, and self-hostable, so the data and the software both stay reachable.",
      "Wikilinks and automatic backlinks: link two notes and the far note grows the reverse link, with the sentence around it.",
      "A knowledge graph of the whole vault, GPU-rendered — Notion has nothing like it.",
      "No per-seat pricing and no AI upsell: bring your own model key.",
      "Works offline-ish and fast on modest hardware; the editor is CodeMirror, not a heavyweight block DOM.",
    ],
    switchIf: [
      "You are using Notion as a personal wiki rather than a team database.",
      "You want to own your notes as files.",
      "You have felt the Notion export problem and do not want to feel it again.",
      "You think in connections and want backlinks and a graph.",
    ],
    stayIf: [
      "You rely on Notion databases — relations, rollups, board views — for real work.",
      "Your team lives in Notion and permissions matter more than file ownership.",
    ],
    migration: {
      steps: [
        {
          name: "Export from Notion as Markdown",
          text: "Settings → Export all workspace content, format Markdown & CSV, and include subpages. Notion emails you a zip.",
        },
        {
          name: "Tidy the filenames",
          text: "Notion appends a 32-character page id to every filename. Strip it with a rename tool before importing so your note titles and links stay readable.",
        },
        {
          name: "Import the zip into Nodum",
          text: "Settings → Vault → Import. Nested pages arrive as nested folders and the markdown body comes across intact.",
        },
        {
          name: "Convert the links you care about",
          text: "Notion's page links export as relative markdown links; rewrite the important ones to [[wikilinks]] so they show up as backlinks and as edges in the graph.",
        },
      ],
      note: "Notion databases do not survive as databases. Export the ones you need as CSV and keep them alongside the notes, or accept that this part of the workspace stays where it is.",
    },
    faqs: [
      {
        question: "Is there an open-source alternative to Notion?",
        answer:
          "Several, and they split by what you use Notion for. For databases and team wikis, AppFlowy and AFFiNE are the closest structurally. For personal knowledge work — linked notes, backlinks, a graph — Nodum is the closer fit: it is MIT licensed, stores plain markdown files, and can be self-hosted with one Docker Compose command.",
      },
      {
        question: "Can I move my Notion pages into Nodum?",
        answer:
          "Yes. Export your workspace from Notion as Markdown & CSV with subpages included, strip the page ids Notion appends to filenames, and import the zip into a Nodum vault. Nested pages become nested folders. Notion databases do not transfer as databases — export those as CSV separately.",
      },
      {
        question: "Does Nodum have databases like Notion?",
        answer:
          "No. Nodum has YAML frontmatter properties, tags, saved searches and a graph, which cover querying and organising notes, but it has no table, board or calendar views over structured records. If Notion databases are load-bearing for you, Nodum is not a replacement for that part.",
      },
    ],
  },
  {
    slug: "logseq",
    name: "Logseq",
    url: "https://logseq.com",
    rank: 3,
    metaTitle: "Logseq alternative — documents instead of outlines",
    headline: "A Logseq alternative for people who write documents, not outlines",
    description:
      "Nodum and Logseq are both open source and both link notes. Nodum is a document editor in the browser; Logseq is a local-first outliner. Here is the honest split.",
    answer:
      "Nodum and Logseq are both open-source, link-first knowledge bases, and the real difference is the writing unit. Logseq is an outliner: everything is a bullet, and blocks are the thing you reference. Nodum is a document editor: a note is a page of prose you can link to and embed. Logseq runs locally; Nodum runs in a browser against a server you can host yourself.",
    keywords: [
      "logseq alternative",
      "logseq vs obsidian",
      "open source logseq alternative",
      "logseq web version",
      "outliner vs document notes",
    ],
    what: "Logseq is an open-source, local-first knowledge base built as an outliner: every line is a block, blocks can be referenced and embedded individually, and the daily journal is the default entry point. It reads and writes markdown or org-mode files on your own disk, is AGPL-3.0 licensed, and has a strong following among people who think in bullets and spaced repetition.",
    facts: {
      license: "AGPL-3.0 — genuinely open source",
      hosting: "Local-first desktop and mobile app; optional paid sync",
      storage: "Markdown or org-mode files on your disk, structured as outlines",
      linking: "[[page links]], ((block references)), tags, and the daily journal",
      graph: "Global and local graph view",
      pricing: "Free; an optional paid sync service",
      platforms: "macOS, Windows, Linux, iOS, Android",
      export: "Files are already on disk, though block-heavy markdown reads oddly elsewhere",
    },
    theyWin: [
      "Block references. Reusing and transcluding a single bullet across pages is Logseq's core idea and Nodum has no direct equivalent.",
      "Local-first and fully offline, with files on your own disk.",
      "Built-in spaced-repetition flashcards.",
      "A journal-first workflow that suits people who capture into a daily page and organise later.",
      "Query blocks build live views over your own outline.",
    ],
    weWin: [
      "Notes are documents. If you write paragraphs rather than bullets, Logseq's markdown fights you and Nodum's does not.",
      "It is a web application, so there is nothing to install and every device sees the same vault.",
      "Files come out as ordinary markdown that reads correctly in any other editor — Logseq's outline markdown carries structural bullets everywhere it goes.",
      "Real-time collaboration with presence on a note.",
      "Publishing a vault as a public site is built in.",
      "An MCP server and an AI assistant on your own key.",
    ],
    switchIf: [
      "You bounced off outlining and want to write prose.",
      "You want the same vault on a work machine you cannot install software on.",
      "You want your markdown to be plain markdown when it leaves.",
    ],
    stayIf: [
      "Block references and transclusion are how you work.",
      "You want flashcards and spaced repetition in the same tool.",
      "Local-first with no server is a requirement, not a preference.",
    ],
    migration: {
      steps: [
        {
          name: "Find your graph folder",
          text: "Logseq keeps a folder with pages/ and journals/ subdirectories. That folder is your data.",
        },
        {
          name: "Flatten the outline where it matters",
          text: "Logseq markdown is bullets all the way down. Pages you want to read as prose elsewhere are worth un-bulleting before or after the import.",
        },
        {
          name: "Zip and import",
          text: "Zip the graph folder and import it in Settings → Vault → Import. [[Page links]] carry over as wikilinks and resolve across the batch.",
        },
        {
          name: "Expect to lose block references",
          text: "((block-id)) references have no target in a document model. Search for them after importing and convert the ones that mattered into links or embeds.",
        },
      ],
    },
    faqs: [
      {
        question: "Is Logseq open source?",
        answer:
          "Yes. Logseq is licensed under AGPL-3.0 and its source is public. Nodum is also open source, under the more permissive MIT licence, which additionally allows closed-source derivatives.",
      },
      {
        question: "What is the difference between Logseq and Nodum?",
        answer:
          "Logseq is a local-first outliner where every line is a referenceable block and the app runs on your own machine against files on disk. Nodum is a browser-based document editor where a note is a page of prose, backed by a server you can self-host. Both use wikilinks, backlinks and a graph.",
      },
      {
        question: "Is there a web version of Logseq?",
        answer:
          "Logseq is distributed as a desktop and mobile application rather than a hosted web app. Nodum is web-native: it runs in any modern browser with nothing installed, against the hosted instance or a server you run yourself.",
      },
    ],
  },
  {
    slug: "evernote",
    name: "Evernote",
    url: "https://evernote.com",
    rank: 4,
    metaTitle: "Evernote alternative — open source markdown notes",
    headline: "An open-source Evernote alternative built on markdown you can take with you",
    description:
      "Leaving Evernote? Nodum is free and open source, stores plain markdown, links notes with [[wikilinks]], and has a web clipper of its own. Self-hostable.",
    answer:
      "Nodum is a free, open-source alternative to Evernote. Evernote is a proprietary hosted notebook with rich-text notes and tiered subscriptions; Nodum stores plain markdown files, links them with wikilinks, draws them as a knowledge graph, and is MIT licensed, so you can self-host it and export everything as a folder of .md files.",
    keywords: [
      "evernote alternative",
      "open source evernote alternative",
      "free evernote alternative",
      "evernote replacement",
      "self hosted evernote alternative",
    ],
    what: "Evernote is the original mass-market digital notebook: notebooks and tags, rich-text notes, a well-known web clipper, OCR over images and scanned documents, and strong search. It has been through several ownership and pricing changes, which is what sends most people looking for an alternative in the first place.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Evernote's cloud",
      storage: "Rich-text notes in a hosted store; ENEX export",
      linking: "Note links and tags; no wikilink syntax and no backlinks pane",
      graph: "No graph view",
      pricing: "Limited free tier with tiered paid plans",
      platforms: "Browser, desktop and mobile",
      export: "ENEX (an XML format) or HTML — converting to markdown takes a tool",
    },
    theyWin: [
      "The web clipper is more mature, and OCR over photographed and scanned documents has no equivalent in Nodum.",
      "Handwriting, audio notes and document scanning in the mobile apps.",
      "Decades of polish on search across mixed media.",
    ],
    weWin: [
      "Free and open source; no plan tiers and no device limits.",
      "Markdown files instead of an XML export format you need a converter for.",
      "Wikilinks, automatic backlinks and a knowledge graph — Evernote has none of these.",
      "Self-hostable, so your archive is not dependent on one company's pricing decisions.",
      "A Chrome web clipper of its own, backed by scoped, revocable tokens that can only create notes.",
    ],
    switchIf: [
      "You have been repriced or feature-limited once too often.",
      "You want your archive in a format any text editor can read in twenty years.",
      "You have started thinking in links rather than notebooks.",
    ],
    stayIf: [
      "You depend on OCR over scanned documents and photographs.",
      "Your notes are mostly handwriting, audio and attachments rather than text.",
    ],
    migration: {
      steps: [
        {
          name: "Export your notebooks as ENEX",
          text: "In Evernote, export each notebook to an .enex file. Do it notebook by notebook so a failure is recoverable.",
        },
        {
          name: "Convert ENEX to markdown",
          text: "Use a converter such as Yarle or evernote2md to turn the .enex files into a folder of .md files with attachments alongside.",
        },
        {
          name: "Zip and import",
          text: "Zip the converted folder and import it into a Nodum vault. Folder structure becomes folders; attachments land in storage and embed as ![[file]].",
        },
        {
          name: "Add the links",
          text: "Evernote notes are rarely linked. Once inside, type [[ and start connecting them — the backlinks pane and the graph fill in from there.",
        },
      ],
    },
    faqs: [
      {
        question: "What is the best open-source Evernote alternative?",
        answer:
          "It depends on what you use Evernote for. Joplin is the closest structural match — notebooks, tags, a clipper, AGPL licensed — and imports ENEX directly. Nodum is the better fit if you want linked notes, backlinks and a knowledge graph in a browser, with markdown files and MIT licensing.",
      },
      {
        question: "How do I move Evernote notes to markdown?",
        answer:
          "Export each notebook as an .enex file from Evernote, then run it through a converter such as Yarle or evernote2md to produce plain .md files with attachments. Zip the result and import it into a Nodum vault, where folders and attachments carry over.",
      },
    ],
  },
  {
    slug: "roam-research",
    name: "Roam Research",
    url: "https://roamresearch.com",
    rank: 5,
    metaTitle: "Roam Research alternative — free and open source",
    headline: "An open-source Roam Research alternative, without the subscription",
    description:
      "Roam made bidirectional linking mainstream and charges for it. Nodum is open source, free, self-hostable, and keeps your notes as plain markdown files.",
    answer:
      "Nodum is a free, open-source alternative to Roam Research. Both are networked-thought tools built on bidirectional links and a graph. Roam is a proprietary, subscription-only outliner with block references; Nodum is MIT-licensed, stores plain markdown files you can export at will, and can be self-hosted.",
    keywords: [
      "roam research alternative",
      "free roam research alternative",
      "open source roam alternative",
      "networked thought app",
      "bidirectional linking app",
    ],
    what: "Roam Research is the tool that put bidirectional linking, the daily notes page and block references in front of a wide audience. It is an outliner in the browser, with a strong graph and a devoted community. It is proprietary, subscription-only, and your database lives on Roam's servers.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Roam's cloud; there is no self-hosted option",
      storage: "A hosted graph database; JSON, EDN and markdown export",
      linking: "[[page links]], ((block refs)), #tags, daily notes",
      graph: "Global and local graph, a signature feature",
      pricing: "Paid subscription only, monthly or yearly, with no free tier",
      platforms: "Browser, with desktop and mobile wrappers",
      export: "JSON/EDN/markdown export, though outline structure travels badly",
    },
    theyWin: [
      "Block references and sidebar-driven exploration remain excellent, and Nodum has no block-level reference.",
      "A distinctive, fast outliner that a lot of people think in.",
      "The community around Roam invented much of this category's vocabulary.",
    ],
    weWin: [
      "Free and MIT licensed rather than subscription-only.",
      "Your notes are markdown files, exportable as a folder-true zip, not a proprietary graph database.",
      "Self-hostable, so the notes survive whatever happens to the company.",
      "Document editing rather than forced outlining.",
      "Real-time collaboration, publishing, an MCP server and a bring-your-own-key AI assistant, all included.",
    ],
    switchIf: [
      "You are paying a Roam subscription for what is, for you, a personal notes app.",
      "You want an exit that produces ordinary markdown.",
      "You would rather write paragraphs than bullets.",
    ],
    stayIf: [
      "Block references are the mechanic you actually use.",
      "The outliner is how you think and a document editor feels wrong.",
    ],
    faqs: [
      {
        question: "Is there a free alternative to Roam Research?",
        answer:
          "Yes. Nodum is free and open source under the MIT licence, with bidirectional links, automatic backlinks, daily notes and a knowledge graph — the features most people leave Roam looking for. Logseq is the other strong free option if you specifically want an outliner with block references.",
      },
      {
        question: "Can I export my Roam graph and use it elsewhere?",
        answer:
          "Roam exports to JSON, EDN or markdown. The markdown export preserves your text and page links but flattens block references, because no document-based tool has a target for them. Import the markdown into a Nodum vault and the [[page links]] resolve across the whole batch.",
      },
    ],
  },
  {
    slug: "joplin",
    name: "Joplin",
    url: "https://joplinapp.org",
    rank: 7,
    metaTitle: "Joplin alternative with backlinks and a graph",
    headline: "A Joplin alternative with wikilinks, backlinks and a graph",
    description:
      "Joplin and Nodum are both open source and both markdown. Joplin is notebooks and sync targets; Nodum is linked notes, backlinks and a browser-native graph.",
    answer:
      "Nodum and Joplin are both open-source markdown note apps, and they organise differently. Joplin is a desktop and mobile app built around notebooks, tags and pluggable sync targets, with an excellent Evernote importer. Nodum is browser-native and link-first: wikilinks, automatic backlinks and a GPU-rendered knowledge graph, on a server you can host yourself.",
    keywords: [
      "joplin alternative",
      "joplin vs obsidian",
      "open source markdown notes app",
      "joplin web version",
      "self hosted markdown notes",
    ],
    what: "Joplin is a long-standing open-source note app under AGPL-3.0: markdown notes in notebooks, end-to-end encrypted sync to a target you choose — Nextcloud, Dropbox, S3, WebDAV or its own service — a web clipper, and a solid Evernote ENEX importer. It is the safe answer for someone leaving Evernote who wants to stay open source.",
    facts: {
      license: "AGPL-3.0 — genuinely open source",
      hosting: "Desktop and mobile app; sync to a target you choose, or Joplin Cloud",
      storage: "Markdown notes in a local database, synced as files to your target",
      linking: "Markdown links between notes; no wikilink syntax and no backlinks pane",
      graph: "No first-party graph view",
      pricing: "Free; Joplin Cloud is an optional paid sync service",
      platforms: "macOS, Windows, Linux, iOS, Android, terminal",
      export: "JEX, markdown or HTML — a clean, well-supported export",
    },
    theyWin: [
      "End-to-end encrypted sync to storage you already own — Nextcloud, S3, WebDAV, Dropbox.",
      "The best Evernote import path in the category.",
      "A mature terminal client, and offline-first apps on every platform.",
      "Years of stability and a large plugin set of its own.",
    ],
    weWin: [
      "Wikilinks and automatic backlinks: Joplin links notes but does not show you the reverse side.",
      "A GPU-rendered knowledge graph, global and local.",
      "It runs in a browser — nothing to install, and the same vault everywhere.",
      "Real-time collaborative editing and publishing built in.",
      "An MCP server and an AI assistant on your own key.",
    ],
    switchIf: [
      "You want to see what links to what.",
      "You want the vault in a browser rather than an installed app.",
      "You want to publish or collaborate on notes.",
    ],
    stayIf: [
      "End-to-end encrypted sync to your own storage is the requirement.",
      "You need offline-first apps on every platform, including a terminal.",
    ],
    faqs: [
      {
        question: "Does Joplin have a graph view?",
        answer:
          "Joplin has no first-party graph view; community plugins add limited versions. Nodum ships a global and a local graph rendered on WebGL2, with node size by degree, ghost nodes for unresolved links, tag and folder filters, and live force controls.",
      },
      {
        question: "Joplin or Nodum — which should I use?",
        answer:
          "Choose Joplin if end-to-end encrypted sync to your own storage and offline-first apps matter most. Choose Nodum if you want linked notes with backlinks and a knowledge graph, in a browser, on a server you can self-host. Both are open source and both keep your notes as markdown.",
      },
    ],
  },
  {
    slug: "onenote",
    name: "Microsoft OneNote",
    url: "https://www.onenote.com",
    rank: 8,
    metaTitle: "OneNote alternative for text-first linked notes",
    headline: "A OneNote alternative for text-first, linked note-taking",
    description:
      "OneNote is a freeform canvas tied to Microsoft accounts. Nodum is open-source, markdown-based linked notes with backlinks and a graph, self-hostable.",
    answer:
      "Nodum is an open-source alternative to Microsoft OneNote for people whose notes are mostly text. OneNote is a freeform notebook canvas built around handwriting and mixed media inside the Microsoft ecosystem. Nodum stores plain markdown files, links them with wikilinks, generates backlinks automatically, and is MIT licensed and self-hostable.",
    keywords: [
      "onenote alternative",
      "open source onenote alternative",
      "onenote alternative markdown",
      "free onenote alternative",
    ],
    what: "OneNote is Microsoft's digital notebook: notebooks, sections and pages, with a freeform canvas you can type or draw anywhere on. It is free with a Microsoft account, syncs through OneDrive, and is excellent with a stylus. It is not markdown, has no wikilinks or backlinks, and its export options are limited.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Microsoft 365 / OneDrive",
      storage: "A proprietary notebook format synced through OneDrive",
      linking: "Internal page links; no wikilink syntax, no backlinks",
      graph: "No graph view",
      pricing: "Free with a Microsoft account; storage counts against OneDrive quota",
      platforms: "Windows, macOS, browser, iOS, Android",
      export: "PDF, or the .one notebook format — no clean markdown path",
    },
    theyWin: [
      "Handwriting and stylus input, which Nodum does not attempt at all.",
      "The freeform canvas: put anything anywhere on the page.",
      "Deep integration with Outlook, Teams and the rest of Microsoft 365.",
      "Free with an account most workplaces already have.",
    ],
    weWin: [
      "Plain markdown files instead of a proprietary notebook format with no real export.",
      "Wikilinks, backlinks and a knowledge graph.",
      "Open source and self-hostable — no Microsoft account, no OneDrive quota.",
      "A real markdown editor with code blocks, KaTeX maths and Mermaid diagrams.",
    ],
    switchIf: [
      "Your notes are text and you have hit OneNote's lack of linking.",
      "You want out of the Microsoft account requirement.",
      "You want an export that is readable without Microsoft software.",
    ],
    stayIf: [
      "You write by hand on a tablet.",
      "Your team runs on Microsoft 365 and shared notebooks are part of the workflow.",
    ],
    faqs: [
      {
        question: "Is there an open-source alternative to OneNote?",
        answer:
          "Yes. For text-first notes, Nodum is MIT licensed, stores plain markdown, and adds wikilinks, backlinks and a knowledge graph. Joplin is the closer match if you want OneNote's notebooks-and-tags structure specifically. Neither replaces OneNote's handwriting and freeform canvas.",
      },
      {
        question: "Can I export OneNote notes to markdown?",
        answer:
          "Not directly. OneNote exports to PDF or its own .one format, so most people convert with a script or a third-party tool, or copy pages out section by section. Once you have markdown, zip the folder and import it into a Nodum vault.",
      },
    ],
  },
  {
    slug: "apple-notes",
    name: "Apple Notes",
    url: "https://www.icloud.com/notes",
    rank: 9,
    metaTitle: "Apple Notes alternative for every platform",
    headline: "An Apple Notes alternative that works everywhere and links everything",
    description:
      "Apple Notes is free and excellent — on Apple devices. Nodum is open-source linked markdown notes in any browser, with backlinks, a graph and real export.",
    answer:
      "Nodum is an open-source alternative to Apple Notes for people who need their notes outside the Apple ecosystem. Apple Notes is free, fast and deeply integrated, but Apple-only and closed. Nodum runs in any browser, stores plain markdown files, links notes with wikilinks, and renders the whole vault as a knowledge graph.",
    keywords: [
      "apple notes alternative",
      "notes app for windows and mac",
      "cross platform notes app",
      "apple notes export markdown",
    ],
    what: "Apple Notes is the built-in note app on iPhone, iPad and Mac: free, instant, well synced through iCloud, with folders, tags, scanning, handwriting and — since recent releases — links between notes. Its limits are its boundaries: it is Apple-only, closed, and its export is not designed for leaving.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "iCloud",
      storage: "A proprietary local database synced through iCloud",
      linking: "Links between notes and #tags; no wikilink syntax, no backlinks pane",
      graph: "No graph view",
      pricing: "Free; storage counts against iCloud quota",
      platforms: "macOS, iOS, iPadOS, plus a limited iCloud web view",
      export: "PDF per note, or copy-paste — no bulk markdown export",
    },
    theyWin: [
      "It is already there, it is instant, and it costs nothing.",
      "Handwriting, document scanning, Apple Pencil and system-wide share sheets.",
      "iCloud sync that simply works across Apple devices.",
    ],
    weWin: [
      "It works on Windows, Linux, Android and every browser — not just Apple hardware.",
      "Markdown files with a real bulk export instead of per-note PDFs.",
      "Wikilinks, automatic backlinks and a knowledge graph.",
      "Open source, MIT licensed and self-hostable.",
      "Code blocks, KaTeX maths, Mermaid diagrams, tables and callouts.",
    ],
    switchIf: [
      "You use a non-Apple machine for part of your day.",
      "You have more than a few hundred notes and want them linked.",
      "You want to be able to get all of it out at once.",
    ],
    stayIf: ["You are all-Apple and your notes are short, visual, and mostly captured on a phone."],
    faqs: [
      {
        question: "How do I export Apple Notes to markdown?",
        answer:
          "Apple Notes has no bulk markdown export. The usual routes are the Exporter app for macOS, an Apple Shortcuts automation, or exporting notes as PDFs and converting. Once you have a folder of .md files, zip it and import it into a Nodum vault.",
      },
      {
        question: "Is there an Apple Notes alternative for Windows?",
        answer:
          "Nodum runs in any modern browser, so the same vault opens on Windows, Linux, macOS, Android and iOS with nothing installed. It is MIT licensed and can be self-hosted, and notes are plain markdown files rather than an iCloud-only database.",
      },
    ],
  },
  {
    slug: "anytype",
    name: "Anytype",
    url: "https://anytype.io",
    rank: 10,
    metaTitle: "Anytype alternative — MIT licensed, plain markdown",
    headline: "An Anytype alternative with plain markdown and an MIT licence",
    description:
      "Anytype is local-first objects and relations under a source-available licence. Nodum is MIT-licensed markdown files with wikilinks, backlinks and a graph.",
    answer:
      "Nodum is an alternative to Anytype for people who want plain markdown rather than an object database. Anytype is local-first and encrypted, built on objects, types and relations, and has spent most of its life under a source-available rather than an OSI-approved licence. Nodum is MIT licensed, stores .md files, and runs in a browser.",
    keywords: [
      "anytype alternative",
      "is anytype open source",
      "local first notes app",
      "encrypted notes app open source",
    ],
    what: "Anytype is a local-first, end-to-end encrypted workspace built on objects and relations rather than documents: everything is a typed object, linked to other objects, synced peer-to-peer between your own devices. It is ambitious and privacy-forward, and it has been shipped under a source-available licence with a stated intention of moving to a fully open one.",
    facts: {
      license: "Source-available for most of its history, with a stated move toward a fully open licence",
      hosting: "Local-first with peer-to-peer sync; self-hosted sync node possible",
      storage: "An encrypted local object store, not markdown files",
      linking: "Objects link to objects; relations rather than wikilink syntax",
      graph: "Graph view over objects and relations",
      pricing: "Free tier with paid storage/sync plans",
      platforms: "macOS, Windows, Linux, iOS, Android",
      export: "Markdown and protobuf export",
    },
    theyWin: [
      "End-to-end encryption and peer-to-peer sync with no server in the middle.",
      "The object-and-relation model is more expressive than files-and-folders for structured data.",
      "Genuinely local-first: it works with no network at all.",
    ],
    weWin: [
      "MIT licensed, unambiguously, with no licence-transition question hanging over it.",
      "Your notes are markdown files rather than rows in an encrypted object store.",
      "It runs in a browser, so no install and no per-device setup.",
      "Obsidian-compatible wikilink syntax and import.",
      "Publishing, collaboration and an MCP server built in.",
    ],
    switchIf: [
      "The licence matters to you and you want an OSI-approved one.",
      "You want files, not objects.",
      "You need browser access from machines you do not control.",
    ],
    stayIf: [
      "End-to-end encryption and peer-to-peer sync are the requirement.",
      "You want typed objects and relations rather than documents.",
    ],
    faqs: [
      {
        question: "Is Anytype open source?",
        answer:
          "Anytype's code is public, but for most of its life it has been released under a source-available licence rather than an OSI-approved open-source one, with the project stating an intention to move to a fully open licence. Nodum is MIT licensed today, which is an OSI-approved licence with no usage restrictions.",
      },
    ],
  },
  {
    slug: "trilium",
    name: "Trilium Notes",
    url: "https://github.com/TriliumNext/Notes",
    rank: 12,
    metaTitle: "Trilium Notes alternative — markdown and wikilinks",
    headline: "A Trilium Notes alternative with wikilinks and an Obsidian-compatible vault",
    description:
      "Trilium is a self-hosted hierarchical knowledge base with scripting. Nodum is self-hosted markdown with [[wikilinks]], backlinks and a GPU knowledge graph.",
    answer:
      "Nodum is an alternative to Trilium Notes for self-hosters who want plain markdown. Both are open source and both are designed to run on your own server. Trilium is a hierarchical note tree with a powerful scripting API and its own storage format; Nodum stores Obsidian-compatible .md files and is built around wikilinks, backlinks and a knowledge graph.",
    keywords: [
      "trilium alternative",
      "triliumnext alternative",
      "self hosted knowledge base",
      "self hosted wiki markdown",
    ],
    what: "Trilium Notes — continued by the community as TriliumNext — is an AGPL-3.0 self-hosted knowledge base built on a deep note hierarchy, with note cloning, attributes, relation maps and a genuinely powerful scripting API. It is a favourite among people who want to program their own note system.",
    facts: {
      license: "AGPL-3.0 — genuinely open source",
      hosting: "Self-hosted server plus desktop clients",
      storage: "Its own database format; markdown and HTML export",
      linking: "Internal links, note cloning, attributes and relation maps",
      graph: "Relation and link maps",
      pricing: "Free; your own hosting cost",
      platforms: "Self-hosted web, plus desktop apps",
      export: "Markdown or HTML archive",
    },
    theyWin: [
      "The scripting API. Trilium lets you write real code against your notes; Nodum's plugin sandbox is deliberately narrower.",
      "Note cloning — one note living in several places in the tree — has no Nodum equivalent.",
      "Attributes and relation maps give it structured-data power Nodum does not match.",
      "A very deep hierarchy model for people who organise by tree.",
    ],
    weWin: [
      "Notes are plain markdown files, so an Obsidian vault imports and exports cleanly both ways.",
      "MIT rather than AGPL, which matters if you intend to build on it commercially.",
      "A GPU-rendered force graph over the whole vault, not just relation maps.",
      "Real-time collaboration, publishing, and an MCP server.",
      "A modern editor with live preview, callouts, KaTeX and Mermaid.",
    ],
    switchIf: [
      "You want Obsidian-compatible markdown rather than a bespoke store.",
      "You want the graph, backlinks and unlinked mentions.",
      "You want collaboration and publishing without extra parts.",
    ],
    stayIf: [
      "You script against your notes.",
      "Cloning and attributes are how your system works.",
    ],
    faqs: [
      {
        question: "What is a good self-hosted alternative to Trilium?",
        answer:
          "Nodum is a close fit: MIT licensed, self-hosted with one Docker Compose command that brings up the API, Postgres, Redis, MinIO and a Caddy edge with automatic TLS, and it stores plain markdown so an existing vault imports and exports cleanly. SilverBullet is the other option if you want a lighter, Lua-scriptable web PKM.",
      },
    ],
  },
  {
    slug: "affine",
    name: "AFFiNE",
    url: "https://affine.pro",
    rank: 13,
    metaTitle: "AFFiNE alternative — linked notes, not whiteboards",
    headline: "An AFFiNE alternative focused on linked notes rather than whiteboards",
    description:
      "AFFiNE pairs docs with an infinite canvas. Nodum is markdown notes, wikilinks, backlinks and a knowledge graph — MIT licensed and self-hostable.",
    answer:
      "Nodum is an alternative to AFFiNE for people who want a knowledge base rather than a whiteboard workspace. AFFiNE combines a block document editor with an Excalidraw-style edgeless canvas and is MIT licensed. Nodum focuses on plain markdown notes, wikilinks, automatic backlinks and a force-directed knowledge graph, with a canvas alongside rather than at the centre.",
    keywords: [
      "affine alternative",
      "open source notion miro alternative",
      "self hosted docs whiteboard",
    ],
    what: "AFFiNE is an open-source, MIT-licensed workspace that puts a block editor and an infinite whiteboard on the same document: write a page, then flip it to edgeless mode and arrange blocks spatially. It is local-first with optional cloud sync, and it is the closest open-source answer to \"Notion plus Miro\".",
    facts: {
      license: "MIT — genuinely open source",
      hosting: "AFFiNE Cloud or self-hosted",
      storage: "Block documents with local-first sync; markdown/HTML/PDF export",
      linking: "Bi-directional page links between docs",
      graph: "No force-directed knowledge graph; the canvas is the spatial view",
      pricing: "Free and open source; paid cloud plans",
      platforms: "Browser, desktop, mobile",
      export: "Markdown, HTML, PDF",
    },
    theyWin: [
      "The edgeless canvas is genuinely good and tightly integrated with the documents.",
      "The block editor feels closer to Notion for people migrating from it.",
      "Docs and whiteboards in one artefact rather than two.",
    ],
    weWin: [
      "Plain markdown files as the storage format, with Obsidian-compatible import and export.",
      "A force-directed knowledge graph over the whole vault.",
      "Automatic backlinks with context snippets, plus unlinked mentions.",
      "An MCP server and a bring-your-own-key AI assistant.",
    ],
    switchIf: [
      "You want a knowledge base first and a canvas second.",
      "You want markdown files rather than block documents.",
      "You want backlinks and a graph.",
    ],
    stayIf: ["The whiteboard is the point, and you think spatially rather than in links."],
    faqs: [
      {
        question: "AFFiNE or Nodum?",
        answer:
          "Both are MIT licensed and both self-host. Choose AFFiNE if you want documents and an infinite whiteboard in one workspace. Choose Nodum if you want a markdown knowledge base with wikilinks, automatic backlinks and a knowledge graph, where the canvas is a feature rather than the centre.",
      },
    ],
  },
  {
    slug: "appflowy",
    name: "AppFlowy",
    url: "https://appflowy.io",
    rank: 14,
    metaTitle: "AppFlowy alternative — linked notes, not databases",
    headline: "An AppFlowy alternative for linked notes instead of databases",
    description:
      "AppFlowy is the open-source Notion clone — pages and databases. Nodum is open-source linked markdown with backlinks and a knowledge graph, in the browser.",
    answer:
      "Nodum is an alternative to AppFlowy for people whose work is linked notes rather than structured databases. AppFlowy is an AGPL-licensed, local-first Notion alternative built in Rust and Flutter, with pages, boards and grids. Nodum is MIT licensed, web-native, and built around markdown files, wikilinks, backlinks and a knowledge graph.",
    keywords: [
      "appflowy alternative",
      "open source notion clone",
      "self hosted appflowy alternative",
    ],
    what: "AppFlowy is an open-source Notion alternative under AGPL-3.0, built in Rust with a Flutter interface. It is local-first, with sync through AppFlowy Cloud or a self-hosted instance, and it reproduces Notion's pages-and-databases model more faithfully than anything else in open source.",
    facts: {
      license: "AGPL-3.0 — genuinely open source",
      hosting: "Local-first, with AppFlowy Cloud or self-hosted sync",
      storage: "A local database with sync; markdown export",
      linking: "Page links and mentions",
      graph: "No knowledge graph",
      pricing: "Free and open source; paid cloud plans",
      platforms: "macOS, Windows, Linux, iOS, Android, browser",
      export: "Markdown and CSV",
    },
    theyWin: [
      "Databases: grids, boards and calendars over structured records, which Nodum does not have.",
      "The closest open-source feel to Notion for a team migrating off it.",
      "Local-first with a native app on every platform.",
    ],
    weWin: [
      "Markdown files as the source of truth, with Obsidian-compatible import and export.",
      "Wikilinks, automatic backlinks with context, and unlinked mentions.",
      "A GPU-rendered knowledge graph.",
      "MIT rather than AGPL.",
      "An MCP server and an AI assistant on your own key.",
    ],
    switchIf: [
      "You want a personal knowledge base, not a database workspace.",
      "You want to see what links to what.",
    ],
    stayIf: ["You need Notion-style databases and views."],
    faqs: [
      {
        question: "Which open-source Notion alternative should I choose?",
        answer:
          "For Notion's databases and team pages, AppFlowy and AFFiNE are the closest. For personal knowledge management — linked notes, backlinks, a graph and plain markdown files — Nodum is the closer fit, and it is MIT licensed and self-hostable with one command.",
      },
    ],
  },
  {
    slug: "silverbullet",
    name: "SilverBullet",
    url: "https://silverbullet.md",
    rank: 15,
    metaTitle: "SilverBullet alternative with a knowledge graph",
    headline: "A SilverBullet alternative with a graph, collaboration and publishing",
    description:
      "Both are self-hosted, browser-based markdown PKMs. SilverBullet is Lua-scriptable and minimal; Nodum adds a GPU graph, collaboration and publishing.",
    answer:
      "Nodum and SilverBullet are the two self-hosted, browser-based markdown knowledge bases. SilverBullet is deliberately minimal and scriptable — plain markdown on disk, extended with Lua. Nodum is heavier: a Postgres-backed multi-tenant server with a GPU knowledge graph, real-time collaboration, publishing, an MCP server and an AI assistant.",
    keywords: [
      "silverbullet alternative",
      "self hosted web markdown notes",
      "browser based note taking self hosted",
    ],
    what: "SilverBullet is an MIT-licensed, self-hosted personal knowledge management system that runs in the browser over a folder of plain markdown files, extended through Lua scripting and a query language. It is lightweight, fast, and popular with people who want the smallest possible thing that works.",
    facts: {
      license: "MIT — genuinely open source",
      hosting: "Self-hosted; a single small server process",
      storage: "Plain markdown files on the server's disk",
      linking: "[[wikilinks]] and page references",
      graph: "No force-directed graph view",
      pricing: "Free; your own hosting cost",
      platforms: "Any browser, installable as a PWA",
      export: "The files are already markdown on disk",
    },
    theyWin: [
      "It is tiny. One process, a folder of files, and you are done — no Postgres, no Redis, no object store.",
      "Lua scripting and live queries let you build behaviour into pages.",
      "Files on disk means any other tool can read them at the same time.",
      "Genuinely offline-capable as a PWA.",
    ],
    weWin: [
      "A GPU-rendered knowledge graph, global and local.",
      "Multi-tenant: real accounts, multiple vaults, and per-user isolation rather than one person's folder.",
      "Real-time collaborative editing with presence.",
      "Publishing a vault as a public site, and per-note share links.",
      "An MCP server with 36 tools, and an AI assistant on your own key.",
      "Full-text search with operators, version history, and a web clipper.",
    ],
    switchIf: [
      "You want the graph, backlinks pane and unlinked mentions.",
      "More than one person needs an account.",
      "You want collaboration or publishing.",
    ],
    stayIf: [
      "You want the smallest possible deployment.",
      "Files-on-disk that other tools can read simultaneously is the requirement.",
      "You script your notes in Lua.",
    ],
    faqs: [
      {
        question: "What is the best self-hosted web-based note-taking app?",
        answer:
          "SilverBullet and Nodum are the two main browser-based, self-hosted markdown options. SilverBullet is the minimal one — a single process over a folder of files, extended with Lua. Nodum is the fuller one — accounts, vaults, a knowledge graph, collaboration, publishing, an MCP server — at the cost of running Postgres, Redis and object storage alongside it.",
      },
    ],
  },
  {
    slug: "remnote",
    name: "RemNote",
    url: "https://www.remnote.com",
    rank: 16,
    metaTitle: "RemNote alternative for linked notes",
    headline: "A RemNote alternative for linked notes without the flashcards",
    description:
      "RemNote pairs an outliner with spaced repetition. Nodum is open-source markdown notes with wikilinks, backlinks and a knowledge graph — no subscription.",
    answer:
      "Nodum is an open-source alternative to RemNote for people who want linked notes without spaced repetition. RemNote is a proprietary outliner that turns notes into flashcards and schedules reviews. Nodum is MIT licensed, stores plain markdown, and focuses on wikilinks, automatic backlinks and a knowledge graph.",
    keywords: [
      "remnote alternative",
      "free remnote alternative",
      "open source spaced repetition notes",
    ],
    what: "RemNote is a proprietary note tool built for students and researchers: an outliner where any line can become a flashcard, with a spaced-repetition scheduler, PDF annotation and citation handling built in. If you are studying for exams, that integration is the whole product.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "RemNote's cloud, with offline support",
      storage: "A hosted document store; markdown export",
      linking: "[[references]], portals and tags",
      graph: "Graph view over rems",
      pricing: "Free tier with paid plans",
      platforms: "Browser, desktop, mobile",
      export: "Markdown and JSON",
    },
    theyWin: [
      "Spaced repetition integrated into the notes themselves — Nodum has nothing comparable.",
      "PDF annotation and citation workflows for academic reading.",
      "The outliner-plus-flashcard model is genuinely effective for exam study.",
    ],
    weWin: [
      "Free and MIT licensed, with no plan tiers.",
      "Plain markdown files with a clean export.",
      "A GPU knowledge graph, backlinks with context, and unlinked mentions.",
      "Self-hostable, so a research archive is not tied to a subscription.",
      "An AI assistant on your own key, and an MCP server.",
    ],
    switchIf: [
      "You stopped using the flashcards and are paying for a notes app.",
      "You want your research notes as files you control.",
    ],
    stayIf: ["Spaced repetition is why you use it."],
    faqs: [
      {
        question: "Does Nodum have spaced repetition or flashcards?",
        answer:
          "No. Nodum has no flashcard or spaced-repetition system, and no plans stated for one. If reviewing material on a schedule is central to how you study, RemNote or Logseq's flashcards will serve you better.",
      },
    ],
  },
  {
    slug: "tana",
    name: "Tana",
    url: "https://tana.inc",
    rank: 17,
    metaTitle: "Tana alternative — plain markdown you can export",
    headline: "A Tana alternative built on plain markdown you can export",
    description:
      "Tana is supertags and structured outlining in the cloud. Nodum is open-source markdown, wikilinks, backlinks and a knowledge graph you can self-host.",
    answer:
      "Nodum is an open-source alternative to Tana for people who want plain files rather than a structured graph database. Tana is a proprietary, subscription outliner built on supertags and fields, which is powerful for structured capture. Nodum stores markdown files, links them with wikilinks, and is MIT licensed and self-hostable.",
    keywords: ["tana alternative", "free tana alternative", "supertags alternative"],
    what: "Tana is a proprietary outliner where nodes carry supertags and typed fields, so the same content can behave like a database, a task list and a note at once. It is genuinely novel and well liked by people doing heavy structured capture, and it is cloud-only and subscription-based.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Tana's cloud; no self-hosting",
      storage: "A hosted structured graph, not files",
      linking: "Node references, supertags and fields",
      graph: "Structured views rather than a force-directed graph",
      pricing: "Subscription, with a limited free tier",
      platforms: "Browser, desktop, mobile",
      export: "JSON export; markdown export is limited",
    },
    theyWin: [
      "Supertags and typed fields are more expressive than tags plus frontmatter.",
      "Structured capture and live views over your own schema.",
      "Voice capture and meeting workflows are unusually well built.",
    ],
    weWin: [
      "Markdown files with a real export, rather than a hosted structured graph.",
      "Free and MIT licensed, with self-hosting available.",
      "A force-directed knowledge graph, backlinks with context, unlinked mentions.",
      "No subscription and no per-seat cost.",
    ],
    switchIf: [
      "You want an exit that produces ordinary markdown.",
      "You are paying for structure you do not use.",
    ],
    stayIf: ["Supertags and typed fields are how your system works."],
    faqs: [
      {
        question: "Is there a free, open-source alternative to Tana?",
        answer:
          "Nodum is the closest for linked note-taking: free, MIT licensed, self-hostable, with wikilinks, backlinks, tags, YAML frontmatter properties and a knowledge graph. It does not replicate Tana's supertags and typed-field system, which has no direct open-source equivalent.",
      },
    ],
  },
  {
    slug: "capacities",
    name: "Capacities",
    url: "https://capacities.io",
    rank: 18,
    metaTitle: "Capacities alternative — open-source markdown",
    headline: "A Capacities alternative with markdown files and an open licence",
    description:
      "Capacities organises notes as typed objects in the cloud. Nodum is open-source markdown with wikilinks, backlinks and a knowledge graph, self-hostable.",
    answer:
      "Nodum is an open-source alternative to Capacities. Capacities is a proprietary, cloud-hosted studio for the mind that organises everything into typed objects — books, people, ideas — with a daily note at the centre. Nodum stores plain markdown files, links them with wikilinks and tags, and is MIT licensed and self-hostable.",
    keywords: ["capacities alternative", "object based note taking", "free capacities alternative"],
    what: "Capacities is a proprietary note app built on object types: rather than files in folders, every note is an object of some type with its own properties and views. Combined with a daily note and a clean interface, it appeals strongly to people who found folders limiting.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Capacities' cloud; no self-hosting",
      storage: "A hosted object store; markdown export",
      linking: "Object links and backlinks",
      graph: "Object graph view",
      pricing: "Free tier with a paid Believer plan",
      platforms: "Browser, desktop, mobile",
      export: "Markdown export",
    },
    theyWin: [
      "Typed objects give structure that tags and frontmatter only approximate.",
      "A very polished, calm interface and a strong daily-note workflow.",
    ],
    weWin: [
      "Markdown files you own, with a folder-true export.",
      "Free, MIT licensed and self-hostable.",
      "A GPU force graph over the whole vault, plus unlinked mentions.",
      "Obsidian-compatible import, so a vault moves in cleanly.",
    ],
    switchIf: [
      "You want your notes as files rather than objects in someone's cloud.",
      "Self-hosting or open source matters to you.",
    ],
    stayIf: ["Typed objects are the reason you use it."],
    faqs: [
      {
        question: "Is there an open-source Capacities alternative?",
        answer:
          "Nodum is the closest open-source fit for the linked-notes half of Capacities: MIT licensed, markdown files, wikilinks, automatic backlinks, tags with nesting, YAML properties, daily notes and a knowledge graph. It does not reproduce Capacities' typed-object model.",
      },
    ],
  },
  {
    slug: "heptabase",
    name: "Heptabase",
    url: "https://heptabase.com",
    rank: 19,
    metaTitle: "Heptabase alternative — linked notes, not boards",
    headline: "A Heptabase alternative for people who link notes rather than arrange them",
    description:
      "Heptabase is whiteboard-first visual sensemaking. Nodum is open-source markdown notes with wikilinks, backlinks and a force-directed knowledge graph.",
    answer:
      "Nodum is an open-source alternative to Heptabase for people who connect notes with links rather than by arranging cards on a board. Heptabase is a proprietary, subscription visual note tool where whiteboards are the primary surface. Nodum is MIT licensed, markdown-based, and organised around wikilinks, backlinks and a knowledge graph.",
    keywords: ["heptabase alternative", "visual note taking app", "free heptabase alternative"],
    what: "Heptabase is a proprietary tool for visual sensemaking: notes are cards you place on infinite whiteboards, grouping and connecting them spatially while you work through a topic. For literature review and research synthesis it is genuinely distinctive.",
    facts: {
      license: "Proprietary, closed source",
      hosting: "Heptabase's cloud, with offline support",
      storage: "A hosted store with local cache; markdown export",
      linking: "Card links, backlinks and spatial grouping on whiteboards",
      graph: "Whiteboards rather than a force-directed graph",
      pricing: "Paid subscription with a trial",
      platforms: "Browser, desktop, mobile",
      export: "Markdown export",
    },
    theyWin: [
      "Whiteboard-first thinking, which is a real and different way to work through a topic.",
      "PDF and highlight workflows for research reading.",
      "Card-on-board spatial memory that a force graph does not replace.",
    ],
    weWin: [
      "Free and MIT licensed rather than subscription-only.",
      "Plain markdown files with a folder-true export and Obsidian-compatible import.",
      "A force-directed knowledge graph over the whole vault, plus backlinks with context.",
      "Self-hostable, with collaboration, publishing and MCP included.",
      "Nodum has a canvas too — it is simply not the centre of the product.",
    ],
    switchIf: [
      "You want linked notes as the backbone, with a canvas available when you need one.",
      "You want to own the files and stop paying a subscription.",
    ],
    stayIf: ["The whiteboard is how you think through a problem."],
    faqs: [
      {
        question: "Does Nodum have a whiteboard or canvas?",
        answer:
          "Yes. Nodum includes freeform canvas boards alongside notes, so you can arrange cards spatially. It is not as central or as developed as Heptabase's whiteboards, which are the whole product there rather than one feature among many.",
      },
    ],
  },
];

/** Hub ordering: most-searched first, which is what `rank` encodes. */
export const ALTERNATIVES_BY_RANK = [...ALTERNATIVES].sort((a, b) => a.rank - b.rank);

export function getAlternative(slug: string): Alternative | undefined {
  return ALTERNATIVES.find((a) => a.slug === slug);
}

export const ALTERNATIVE_SLUGS = ALTERNATIVES.map((a) => a.slug);
