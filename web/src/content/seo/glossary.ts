/**
 * The glossary.
 *
 * Deliberately *one page* rather than one page per term. Thirty pages of
 * eighty words each is the exact shape Google spent 2026 deindexing, and it
 * would not serve a reader either — nobody wants to click through five pages
 * to learn what a backlink and an unlinked mention are. One page, anchored per
 * term, carries a `DefinedTermSet` and reads like a reference.
 *
 * Its real job is entity coverage. Generative engines resolve a query against
 * the entities a page demonstrably knows about, and a page that correctly
 * defines thirty adjacent terms in this domain is strong evidence that the
 * site is about this domain. Terms that need a full argument rather than a
 * definition get their own topic page instead, linked from here.
 */

export interface GlossaryTerm {
  /** Anchor id: kebab-case, stable, linked from elsewhere. */
  id: string;
  term: string;
  /** Other names people search for. Feeds `alternateName` on the schema. */
  aka?: string[];
  /** One or two sentences. Self-contained — it may be quoted alone. */
  definition: string;
  /** Optional second paragraph for the terms that need one. */
  detail?: string;
  /** A deeper page on this subject, if one exists. */
  more?: { label: string; path: string };
  /** Grouping on the page. */
  group: GlossaryGroup;
}

export const GLOSSARY_GROUPS = [
  "Linking",
  "Structure",
  "Method",
  "Writing",
  "Software",
] as const;

export type GlossaryGroup = (typeof GLOSSARY_GROUPS)[number];

export const GLOSSARY: GlossaryTerm[] = [
  // ── Linking ──────────────────────────────────────────────
  {
    id: "wikilink",
    term: "Wikilink",
    aka: ["wiki link", "double bracket link"],
    group: "Linking",
    definition:
      "A link written as [[Note title]] that points at another note by its title rather than by a file path. Because the app resolves it, a wikilink survives the target being moved or renamed, and can be written before the target note exists.",
    detail:
      "Variants add precision without adding ceremony: [[folder/Note]] disambiguates two notes with the same title, [[Note|alias]] changes the displayed text, [[Note#Heading]] targets a heading, and ![[Note]] embeds the content inline instead of linking to it.",
    more: { label: "Backlinks and wikilinks", path: "/learn/backlinks" },
  },
  {
    id: "backlink",
    term: "Backlink",
    aka: ["linked mention", "reverse link"],
    group: "Linking",
    definition:
      "The automatic reverse of a link. If note A contains a link to note B, then note B shows that A references it — usually with the surrounding sentence for context. You write one direction; the software maintains the other.",
    more: { label: "Backlinks and wikilinks", path: "/learn/backlinks" },
  },
  {
    id: "bidirectional-link",
    term: "Bidirectional link",
    aka: ["two-way link", "backlinking"],
    group: "Linking",
    definition:
      "A link that is visible and navigable from both ends. In practice it means writing a normal one-way link and having the software generate the return view, which is what makes dense linking cheap enough to sustain.",
  },
  {
    id: "unlinked-mention",
    term: "Unlinked mention",
    group: "Linking",
    definition:
      "A place where a note's title appears as plain text somewhere else in the vault without being a link. Usually text written before that note existed. Reviewing unlinked mentions is the fastest way to connect an existing pile of notes.",
  },
  {
    id: "unresolved-link",
    term: "Unresolved link",
    aka: ["ghost node", "dangling link"],
    group: "Linking",
    definition:
      "A wikilink whose target note does not exist yet. It is valid, and it appears in the graph as a hollow node. Clicking it creates the note with the backlink already resolved, which makes 'write the link now, write the note later' a workable habit.",
  },
  {
    id: "transclusion",
    term: "Transclusion",
    aka: ["embed", "note embed"],
    group: "Linking",
    definition:
      "Including one note's content inside another so that it renders in place and updates when the source changes. Written as ![[Note]] or ![[Note#Heading]]. Distinct from copying, which forks the text and lets the copies drift.",
  },
  {
    id: "block-reference",
    term: "Block reference",
    group: "Linking",
    definition:
      "A link to a single block — usually one paragraph or bullet — rather than to a whole note. Roam, Logseq and Obsidian support them with ((id)) or ^id syntax. Document-oriented tools including Nodum generally do not, because the unit of meaning is the note.",
  },
  {
    id: "knowledge-graph",
    term: "Knowledge graph",
    aka: ["graph view", "note graph"],
    group: "Linking",
    definition:
      "A visualisation in which every note is a node and every link is an edge, arranged by a force simulation so connected notes pull together. Its value is structural: it shows clusters, orphaned notes and gaps between areas of your thinking that search cannot surface.",
    more: { label: "What a knowledge graph shows you", path: "/learn/knowledge-graph" },
  },
  {
    id: "local-graph",
    term: "Local graph",
    group: "Linking",
    definition:
      "A graph restricted to the neighbourhood of one note — its links, their links, and so on to an adjustable depth. More useful than the global graph for day-to-day work, because it answers 'what is this note near?' rather than 'what does everything look like?'.",
  },
  {
    id: "orphan-note",
    term: "Orphan note",
    group: "Linking",
    definition:
      "A note that nothing links to and which links to nothing. Some orphans are fine — a shopping list is not supposed to be connected. Others are ideas captured and then abandoned, and finding them is usually the point of filtering for them.",
  },

  // ── Structure ────────────────────────────────────────────
  {
    id: "vault",
    term: "Vault",
    group: "Structure",
    definition:
      "One self-contained collection of notes, with its own folders, tags, links and graph. The term comes from Obsidian, where a vault is a folder on disk. In Nodum a user can own several vaults, and links resolve within a vault rather than across them.",
  },
  {
    id: "frontmatter",
    term: "Frontmatter",
    aka: ["YAML frontmatter", "properties"],
    group: "Structure",
    definition:
      "A block of YAML at the very top of a markdown file, fenced by ---, holding structured properties: tags, aliases, dates, status, anything you want to query on later. It travels with the file, so the metadata does not depend on the app that wrote it.",
  },
  {
    id: "nested-tag",
    term: "Nested tag",
    group: "Structure",
    definition:
      "A tag with hierarchy, written #parent/child. Searching the parent matches every child, which gives you a taxonomy without giving up the flatness that makes tags easy to apply. Both inline #tags and frontmatter tags can nest.",
  },
  {
    id: "map-of-content",
    term: "Map of content",
    aka: ["MOC", "index note", "structure note"],
    group: "Structure",
    definition:
      "A note whose body is mostly curated links, describing one region of a vault. It is the entry point into a cluster of notes — the digital equivalent of the hub cards Luhmann kept. Worth writing when a cluster gets too big to hold in your head, and not before.",
  },
  {
    id: "daily-note",
    term: "Daily note",
    aka: ["journal", "daily journal"],
    group: "Structure",
    definition:
      "One note per day, created automatically from a template, used as a capture surface. It removes the 'where does this go?' decision at the moment of writing, which is exactly when that decision is most expensive.",
  },
  {
    id: "attachment",
    term: "Attachment",
    group: "Structure",
    definition:
      "A non-markdown file — an image, a PDF, an audio file — stored alongside notes and embedded with ![[filename]]. In Nodum attachments live in S3-compatible object storage and are served through presigned URLs.",
  },

  // ── Method ───────────────────────────────────────────────
  {
    id: "second-brain",
    term: "Second brain",
    aka: ["digital brain", "external brain"],
    group: "Method",
    definition:
      "An external, searchable store of what you have read, decided and worked out, structured so past-you can hand something usable to future-you. The term was popularised by Tiago Forte; the practice long predates it.",
    more: { label: "Building a second brain", path: "/learn/second-brain" },
  },
  {
    id: "zettelkasten",
    term: "Zettelkasten",
    aka: ["slip box", "slip-box method"],
    group: "Method",
    definition:
      "German for 'slip box'. A note method with three rules: one idea per note, written in your own words, and linked to related notes rather than filed by topic. Associated with the sociologist Niklas Luhmann, who used a paper version to produce a very large body of work.",
    more: { label: "Zettelkasten, without the mystique", path: "/learn/zettelkasten" },
  },
  {
    id: "atomic-note",
    term: "Atomic note",
    group: "Method",
    definition:
      "A note containing exactly one idea. Atomicity is what makes a note linkable with precision and reusable in contexts you did not anticipate; a note holding six ideas can only ever be referenced as a lump.",
  },
  {
    id: "evergreen-note",
    term: "Evergreen note",
    group: "Method",
    definition:
      "A note written to be rewritten — improved and re-argued over time rather than appended to and abandoned. The formulation is Andy Matuschak's, and it is the single most useful idea to take from the note-writing literature.",
  },
  {
    id: "pkm",
    term: "Personal knowledge management",
    aka: ["PKM"],
    group: "Method",
    definition:
      "The practice of capturing what you encounter, connecting it to what you already know, and retrieving it when relevant. The connecting step is what separates it from simply keeping files, and it is the step most systems quietly skip.",
    more: { label: "PKM, minus the theatre", path: "/learn/personal-knowledge-management" },
  },
  {
    id: "para",
    term: "PARA",
    group: "Method",
    definition:
      "Projects, Areas, Resources, Archive — an organising scheme that files notes by how actionable they are rather than by subject. Strong for active work; weaker as a long-term thinking archive, since 'archive' is where ideas go quiet.",
  },
  {
    id: "networked-thought",
    term: "Networked thought",
    group: "Method",
    definition:
      "The general name for working in a note system where structure comes from links between notes rather than from a folder hierarchy. Roam Research popularised the phrase; the tools in this category are sometimes called networked-thought or tools-for-thought apps.",
  },

  // ── Writing ──────────────────────────────────────────────
  {
    id: "markdown",
    term: "Markdown",
    group: "Writing",
    definition:
      "A plain-text format with a light convention for structure — headings, emphasis, lists, links, code. It is readable without any software rendering it, which is why it is the format with the longest demonstrated shelf life for notes.",
    more: { label: "Why notes should be markdown", path: "/learn/markdown-notes" },
  },
  {
    id: "live-preview",
    term: "Live preview",
    group: "Writing",
    definition:
      "An editing mode where markdown renders in place as you type, and the raw syntax reveals itself on the line your cursor is on. It replaces the older split-screen model of raw markdown beside a rendered preview.",
  },
  {
    id: "reading-view",
    term: "Reading view",
    group: "Writing",
    definition:
      "A fully rendered, non-editable view of a note — no syntax, no cursor, just the document. Useful for review and for sharing, and the view public published pages use.",
  },
  {
    id: "callout",
    term: "Callout",
    aka: ["admonition"],
    group: "Writing",
    definition:
      "A styled block for asides, warnings and notes, written as a blockquote with a type marker: > [!note], > [!warning]. The syntax comes from Obsidian and is now widely supported. Nodum implements the full set with icons, colours and folding.",
  },
  {
    id: "quick-switcher",
    term: "Quick switcher",
    group: "Writing",
    definition:
      "A fuzzy search box, usually on ⌘O, that jumps to a note by title — and creates the note when nothing matches. The single most important capture affordance in a linked-note app, because it collapses 'find or make a note' into one keystroke.",
  },
  {
    id: "command-palette",
    term: "Command palette",
    group: "Writing",
    definition:
      "A searchable list of every command in the application, usually on ⌘P. It removes the need to memorise shortcuts or hunt through menus, and it is how most people discover what an app can actually do.",
  },

  // ── Software ─────────────────────────────────────────────
  {
    id: "local-first",
    term: "Local-first",
    group: "Software",
    definition:
      "Software where the primary copy of your data lives on your own device and the network is an optimisation rather than a requirement. Obsidian, Logseq and Anytype are local-first. Nodum is not — it is a server application, with self-hosting as the ownership story instead.",
  },
  {
    id: "self-hosting",
    term: "Self-hosting",
    group: "Software",
    definition:
      "Running the server software yourself, on hardware you control, rather than using a vendor's hosted instance. It removes vendor risk and per-seat pricing, and adds operational responsibility: backups, updates and TLS become yours.",
    more: { label: "Self-hosted notes", path: "/learn/self-hosted-notes" },
  },
  {
    id: "open-source",
    term: "Open source",
    group: "Software",
    definition:
      "Software published under a licence that permits reading, modifying, running and redistributing the source. Distinct from an open file format: Obsidian has an open format and closed source, while Nodum, Logseq and Joplin are open on both counts.",
    more: { label: "Open-source note-taking", path: "/learn/open-source-note-taking" },
  },
  {
    id: "mcp",
    term: "Model Context Protocol",
    aka: ["MCP", "MCP server"],
    group: "Software",
    definition:
      "An open protocol that lets AI clients — Claude Code, Claude Desktop, Cursor — call tools on an external system. Nodum is an MCP server with 36 tools over the same services and ownership checks the app uses, so an AI assistant can read, search, create and link notes in your vault.",
    more: { label: "AI note-taking", path: "/learn/ai-note-taking" },
  },
  {
    id: "full-text-search",
    term: "Full-text search",
    group: "Software",
    definition:
      "Search across the body of every note, not just titles. Nodum uses PostgreSQL full-text search with a GIN-indexed tsvector, supporting path:, file: and tag: operators, quoted phrases and -exclusions.",
  },
  {
    id: "web-clipper",
    term: "Web clipper",
    group: "Software",
    definition:
      "A browser extension that saves a page — or a selection of one — into your notes with its source URL recorded. Nodum's is an MV3 Chrome extension backed by scoped, hashed, revocable tokens that can only create notes, so revoking one never touches your session.",
  },
  {
    id: "canvas",
    term: "Canvas",
    aka: ["whiteboard", "infinite canvas"],
    group: "Software",
    definition:
      "A freeform board where notes appear as cards you can arrange spatially and connect with lines. Useful for working through a problem visually. In Nodum it sits alongside notes rather than being the primary surface.",
  },
];

export const GLOSSARY_BY_GROUP = GLOSSARY_GROUPS.map((group) => ({
  group,
  terms: GLOSSARY.filter((t) => t.group === group),
}));
