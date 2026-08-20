import type { Faq } from "@/lib/seo/jsonld";

/**
 * The site-level FAQ.
 *
 * These are the questions a generative engine is actually asked about this
 * product — "is it free?", "is it open source?", "can it import an Obsidian
 * vault?" — and the answers are written to survive being quoted with the
 * question detached: each names Nodum explicitly rather than starting with
 * "Yes, it does", and each is a complete claim rather than a pointer at
 * another page.
 *
 * A subset is rendered on the landing page; the whole set lives at /faq.
 */

export interface FaqEntry extends Faq {
  /** Grouping on /faq. */
  group: FaqGroup;
  /** Show this one on the landing page. */
  featured?: boolean;
}

export const FAQ_GROUPS = [
  "The basics",
  "Coming from another app",
  "Features",
  "AI and automation",
  "Running it yourself",
] as const;

export type FaqGroup = (typeof FAQ_GROUPS)[number];

export const FAQS: FaqEntry[] = [
  // ── The basics ───────────────────────────────────────────
  {
    group: "The basics",
    featured: true,
    question: "What is Nodum?",
    answer:
      "Nodum is a free, open-source, web-based knowledge base. You write markdown notes, connect them with [[wikilinks]], get backlinks automatically, and explore the whole vault as a GPU-rendered knowledge graph. It is MIT licensed, runs in any modern browser, and can be self-hosted with one Docker Compose command.",
  },
  {
    group: "The basics",
    featured: true,
    question: "Is Nodum free?",
    answer:
      "Yes. Nodum is free and open source under the MIT licence, with no paid tier holding features back and no per-seat pricing. You can use the hosted instance or run your own, in which case the only cost is the server you run it on.",
  },
  {
    group: "The basics",
    featured: true,
    question: "Is Nodum open source?",
    answer:
      "Yes — the whole stack. The FastAPI backend and the Next.js frontend are both MIT licensed and published in one public repository, with no open-core split and no separate proprietary server. You can read it, fork it, audit it and run it.",
  },
  {
    group: "The basics",
    question: "What does 'Nodum' mean?",
    answer:
      "Nodum is Latin for 'knot' or 'node'. The name is the argument: notes are the knots, and the value is the rope between them — the links, not the individual pages.",
  },
  {
    group: "The basics",
    question: "Do I need to install anything to use Nodum?",
    answer:
      "No. Nodum runs in any modern browser, so a locked-down work laptop, a Chromebook, a borrowed machine and a phone all reach the same vault with nothing installed. It can also be installed as a PWA if you want it in its own window.",
  },
  {
    group: "The basics",
    question: "Who is Nodum for?",
    answer:
      "People who write a lot and want their notes connected: researchers, engineers, students, writers and anyone building a long-lived personal knowledge base. It suits you particularly if you want the software to be open source and the notes to be plain files you can take elsewhere.",
  },

  // ── Coming from another app ──────────────────────────────
  {
    group: "Coming from another app",
    featured: true,
    question: "Can I import my Obsidian vault?",
    answer:
      "Yes. Zip your Obsidian vault folder and import it from Settings → Vault → Import. Nodum resolves wikilinks across the whole batch rather than file by file, unwraps a redundant root folder, detects .obsidian config directories, imports .md, .markdown and .txt as notes, and brings PDFs in as attachments plus a note of their extracted text.",
  },
  {
    group: "Coming from another app",
    question: "Can I get my notes back out?",
    answer:
      "Yes, at any time. Export produces a folder-true zip of .md files — the same shape an Obsidian vault is, and the same thing Nodum's importer accepts. There is also a versioned REST API and an MCP server if you want programmatic access.",
  },
  {
    group: "Coming from another app",
    question: "Does Nodum support Obsidian plugins?",
    answer:
      "No. Obsidian plugins are written against Obsidian's own Node-level API, while Nodum's plugin API is capability-scoped and runs inside an opaque-origin sandboxed iframe — a deliberately different and narrower contract. If a specific plugin is central to how you work, Obsidian remains the right tool.",
  },
  {
    group: "Coming from another app",
    question: "How do I move from Notion or Evernote?",
    answer:
      "Export to markdown first. Notion exports as Markdown & CSV with subpages; strip the page ids it appends to filenames before importing. Evernote exports as .enex, which a converter such as Yarle or evernote2md turns into markdown. Then zip the folder and import it into a Nodum vault.",
  },

  // ── Features ─────────────────────────────────────────────
  {
    group: "Features",
    featured: true,
    question: "Does Nodum have a graph view?",
    answer:
      "Yes — global and local, rendered on WebGL2 through a GPU force simulation, so it stays smooth into the tens of thousands of notes. Node size follows link count, unresolved links appear as ghost nodes you can click to create, and folder colours carry through from the explorer into the graph.",
  },
  {
    group: "Features",
    question: "What markdown does Nodum support?",
    answer:
      "Obsidian-compatible markdown: wikilinks with paths, aliases, heading targets and embeds; the full callout set; YAML frontmatter; GFM tables and footnotes; task lists; KaTeX maths inline and block; Mermaid diagrams; and syntax-highlighted code fences. The editor is CodeMirror 6 with live preview, source and reading modes.",
  },
  {
    group: "Features",
    question: "Can two people edit the same note at once?",
    answer:
      "Yes. Nodum has real-time collaborative editing per note using Yjs CRDTs over websockets, with presence, and it works across multiple API workers rather than only in a single-process deployment.",
  },
  {
    group: "Features",
    question: "Can I publish notes publicly?",
    answer:
      "Yes, at two levels. Any note can get an unlisted public share link, revocable at any time. Any vault can be published as a public site at /s/your-slug, with working links between the published notes. Both are included rather than sold as a separate product.",
  },
  {
    group: "Features",
    question: "Does Nodum keep note history?",
    answer:
      "Yes. Every save is snapshotted server-side, and you can browse and restore previous versions of a note from its version history. This is cheap to offer precisely because Nodum is server-based.",
  },

  // ── AI and automation ────────────────────────────────────
  {
    group: "AI and automation",
    featured: true,
    question: "Does Nodum have AI features?",
    answer:
      "Yes, and they run on your own API key. The assistant searches, reads, creates and extends notes in your vault, streams its replies with live tool status, and works with Claude, OpenAI, Gemini or Qwen. Keys are encrypted at rest and can be set per vault.",
  },
  {
    group: "AI and automation",
    question: "Can Claude or Cursor work with my Nodum notes?",
    answer:
      "Yes. Nodum is a Model Context Protocol server at /api/v1/mcp with 36 tools, using the same services and ownership checks as the app. Point Claude Code, Claude Desktop or Cursor at it with a per-user token and the AI can create vaults, write and link notes, colour folders, search, import and export.",
  },
  {
    group: "AI and automation",
    question: "Are my notes used to train AI models?",
    answer:
      "No. Nodum does not train models on your notes. The assistant sends only what a request needs to the model provider whose key you supplied, and if you self-host and point it at a local model endpoint, nothing leaves your network at all.",
  },
  {
    group: "AI and automation",
    question: "Does Nodum suggest connections between notes?",
    answer:
      "Yes. Alongside the links you write by hand, Nodum surfaces semantically related notes using pgvector cosine similarity over note embeddings, which finds connections you never made explicitly.",
  },

  // ── Running it yourself ──────────────────────────────────
  {
    group: "Running it yourself",
    featured: true,
    question: "Can I self-host Nodum?",
    answer:
      "Yes, with one command. `./compose.sh prod up -d --build` brings up the API, PostgreSQL, Redis, MinIO and a Caddy edge proxy that provisions and renews TLS certificates automatically. Caddy is the only container that binds a host port, and schema migrations run in a one-shot container everything else waits on.",
  },
  {
    group: "Running it yourself",
    question: "What do I need to run Nodum myself?",
    answer:
      "A machine with Docker or Podman, a domain pointed at it, and about an evening for the first deployment. A small VPS is sufficient for personal use. Deployment and backup runbooks are in the repository, and a smoke script drives signup, note creation and an attachment round-trip through the real proxy chain.",
  },
  {
    group: "Running it yourself",
    question: "Is my data private?",
    answer:
      "Nodum is multi-tenant with ownership checks on every path, argon2id password hashing, refresh-token rotation with reuse defence, and rate-limited auth endpoints. If you want the strongest answer, self-host it: the notes then sit on hardware you control, under no third party's terms of service.",
  },
];

export const FEATURED_FAQS = FAQS.filter((f) => f.featured);

export const FAQS_BY_GROUP = FAQ_GROUPS.map((group) => ({
  group,
  faqs: FAQS.filter((f) => f.group === group),
}));
