import type { Faq } from "@/lib/seo/jsonld";

/**
 * The topic cluster: one page per thing a person searches for *before* they
 * know a product name. "second brain app", "open source note taking",
 * "knowledge graph", "ai note taking".
 *
 * These are the pages that have to earn their ranking on substance, because
 * every competitor in the category is writing about the same nouns. The shape
 * each one commits to:
 *
 *   - `answer` — the first thing on the page, 40–60 words, true on its own.
 *     This is what an AI Overview or a Perplexity citation actually lifts.
 *   - `sections` — real explanation of the concept, written so it would still
 *     be worth reading if Nodum did not exist. A page that only says "and our
 *     product does this" is the kind of page Google spent 2026 removing.
 *   - `checklist` — the decision criteria, which is what someone at this stage
 *     is actually missing.
 *   - `faqs` — question/answer pairs, which double as FAQPage schema.
 *
 * `related` cross-links the cluster. Internal links between topically adjacent
 * pages are how a small site gets its individual pages understood as being
 * about one subject rather than twelve unrelated ones.
 */

export interface TopicSection {
  heading: string;
  /** Paragraphs. Markdown is deliberately not supported — keep prose plain. */
  body: string[];
  /** Optional bullet list rendered under the paragraphs. */
  bullets?: string[];
}

export interface Topic {
  slug: string;
  /** H1 — written as a claim or a question, not a keyword stuffing. */
  title: string;
  /** <title>, without the site suffix. */
  metaTitle: string;
  description: string;
  /** The quotable opening answer. */
  answer: string;
  keywords: string[];
  /** The eyebrow above the H1. */
  eyebrow: string;
  sections: TopicSection[];
  checklist?: { heading: string; intro?: string; items: string[] };
  faqs: Faq[];
  /** Slugs of other topics, plus `/alternatives/...` paths. */
  related: { label: string; path: string }[];
  rank: number;
}

export const TOPICS: Topic[] = [
  {
    slug: "second-brain",
    rank: 1,
    eyebrow: "Second brain",
    title: "What a second brain actually is — and how to build one that lasts",
    metaTitle: "Second brain app — build a second brain with linked notes",
    description:
      "A second brain is an external system for the things you don't want to re-derive. Here's what one needs, and how to build one in an open-source app you own.",
    answer:
      "A second brain is an external, searchable store of what you have read, decided and figured out, structured so that past-you can hand something to future-you. In practice it needs four things: fast capture, plain text you own, links between notes rather than folders alone, and a way to see the whole thing at once.",
    keywords: [
      "second brain",
      "second brain app",
      "build a second brain",
      "best second brain app",
      "second brain software",
      "digital brain",
      "digital second brain",
      "personal wiki",
      "brain app",
    ],
    sections: [
      {
        heading: "The problem a second brain solves",
        body: [
          "Most people do not have a note-taking problem. They have a retrieval problem. The notes exist — in a document, a chat thread, a book margin, a half-finished draft — and none of them can be found at the moment they would have been useful. Capture without retrieval is just a slower way of forgetting.",
          "A second brain is the fix: one place where everything you have thought about goes, structured so that finding a thing does not require remembering where you put it. The name comes from Tiago Forte's *Building a Second Brain*, but the practice is much older — the commonplace book, the card index, Niklas Luhmann's Zettelkasten. What changed is that software made the linking cheap.",
        ],
      },
      {
        heading: "Folders are not enough, and neither is search",
        body: [
          "Folders force a decision you cannot make correctly at capture time: which single category does this belong to? A note about pricing psychology written while reading a book about behavioural economics for a project about onboarding belongs in three places, so it ends up in whichever one you thought of first and is lost to the other two.",
          "Search fixes retrieval only when you remember the words. It cannot tell you what a note is *related* to, which is the part you actually forgot. That is what links are for: instead of filing a note, you connect it to the notes it has something to do with, and the connection is the memory.",
        ],
      },
      {
        heading: "The four things a second brain needs",
        body: [
          "Strip away the methodology arguments and the requirements are fairly stable across every system that has worked for anyone:",
        ],
        bullets: [
          "**Capture that takes seconds.** If writing a note is a project, you will not write it. A quick switcher, a daily note and a web clipper cover most of it.",
          "**Plain text you own.** A second brain is a decades-long artefact. It should outlive the app it was written in, which means markdown files and a real export, not a hosted database with a lossy CSV escape hatch.",
          "**Links, and the reverse of links.** Writing `[[Compound interest]]` in one note should make that note visible *from* the other side. Backlinks are what turn a pile of notes into a network.",
          "**A view of the whole thing.** A graph of your notes tells you where the dense clusters are, which ideas are orphaned, and which two areas of your thinking have never once been connected.",
        ],
      },
      {
        heading: "How this works in Nodum",
        body: [
          "Nodum is an open-source second-brain app that runs in a browser. Notes are plain markdown files. Typing `[[` autocompletes across every note you have; the note on the other end grows a backlink automatically, with the sentence around it for context. Link a note that does not exist yet and it appears on the graph as a ghost node — click it and the note is created, with the backlink already resolved.",
          "The graph is the whole vault, force-simulated on the GPU, and stays smooth into the tens of thousands of notes. Colour a folder in the explorer and its notes carry that colour into the graph, so the shape of your thinking becomes something you can actually look at.",
          "Because it is MIT licensed you can read every line of it, and because it self-hosts with one Docker Compose command, the second brain you spend five years building does not depend on a company continuing to exist.",
        ],
      },
    ],
    checklist: {
      heading: "Choosing a second-brain app: what to check before you commit",
      intro:
        "You are choosing something you intend to use for years. These are the questions worth asking before the first note, not after the thousandth.",
      items: [
        "Can I export everything, in a format another tool can read, without a conversion script?",
        "Are notes plain files, or rows in someone's database?",
        "Does linking two notes take one keystroke, or a menu?",
        "Do I get backlinks automatically, or do I have to maintain both directions by hand?",
        "Can I see the whole collection at once?",
        "If the company disappears tomorrow, do I still have working software — or just a folder and a problem?",
        "Does it work on every machine I use, including the one I cannot install software on?",
      ],
    },
    faqs: [
      {
        question: "What is the best second brain app?",
        answer:
          "There is no single best one, but the shortlist is consistent: Obsidian if you want local files and the largest plugin ecosystem, Logseq if you think in outlines, Notion if your second brain is really a team wiki, and Nodum if you want an open-source, browser-based option with wikilinks, automatic backlinks and a knowledge graph that you can self-host.",
      },
      {
        question: "Is there a free second brain app?",
        answer:
          "Yes. Nodum is free and open source under the MIT licence, with no plan tiers, and it can be self-hosted at your own infrastructure cost. Obsidian's core app is also free, and Logseq is free and AGPL licensed.",
      },
      {
        question: "How do I start building a second brain?",
        answer:
          "Start by writing notes, not by designing a system. Capture one note per idea, give each a title you would search for, and link them with wikilinks as you notice connections. Structure emerges from the links after a few hundred notes; a folder hierarchy designed on day one almost never survives.",
      },
      {
        question: "What is the difference between a second brain and a Zettelkasten?",
        answer:
          "A Zettelkasten is one specific method for building a second brain: atomic, self-contained notes written in your own words, linked to each other rather than filed by topic. Second brain is the broader term and includes methods like PARA that organise by actionability instead. Both need the same underlying capability: cheap linking.",
      },
    ],
    related: [
      { label: "Zettelkasten, in practice", path: "/learn/zettelkasten" },
      { label: "Personal knowledge management", path: "/learn/personal-knowledge-management" },
      { label: "What a knowledge graph shows you", path: "/learn/knowledge-graph" },
      { label: "Open-source Obsidian alternative", path: "/alternatives/obsidian" },
    ],
  },
  {
    slug: "ai-note-taking",
    rank: 2,
    eyebrow: "AI notes",
    title: "AI note-taking that reads your own notes — not someone else's model of them",
    metaTitle: "AI note taking app — an AI brain over your own markdown notes",
    description:
      "Most AI note apps rent you a model and keep your notes. Nodum runs an AI assistant over your own vault, on your own API key, in open-source software.",
    answer:
      "An AI note-taking app is only as useful as the notes it can see. Nodum puts an assistant inside your own vault: it searches, reads, creates and extends your notes, streams its replies, and runs on an API key you supply — Claude, OpenAI, Gemini or Qwen — encrypted at rest, with a different key per vault if you want one.",
    keywords: [
      "ai note taking app",
      "best ai note taking app",
      "ai note making tool",
      "best ai note making tool",
      "ai notes",
      "ai brain",
      "ai second brain",
      "ai knowledge base",
      "ai linked notes",
      "ai link notes",
      "notes with ai assistant",
      "bring your own api key notes",
      "mcp note taking",
    ],
    sections: [
      {
        heading: "The thing most AI note apps get backwards",
        body: [
          "The pitch is usually the model: this app has AI in it. But a language model is a commodity you can rent by the token, and the part that is not a commodity is your notes. An AI feature is worth something only when it can read the specific, private, accumulated context that nobody else has — and that means the value lives in the vault, not in the assistant.",
          "This inverts how the product should be built. Rather than a company holding your notes and selling you access to a model, you should hold your notes and bring whichever model you like. When a better model ships next quarter, you change a setting rather than a vendor.",
        ],
      },
      {
        heading: "What an AI assistant should be able to do with a vault",
        body: [
          "Reading a single open note is table stakes and not very useful. The interesting operations need the whole graph:",
        ],
        bullets: [
          "**Search across everything**, then answer from what it found, citing the notes it used.",
          "**Read a note and its neighbours** — the ones it links to and the ones that link back — because the context you wrote three years ago is exactly the context you have forgotten.",
          "**Write into the vault**: create a note, extend one, link it to the right existing notes rather than inventing new orphans.",
          "**Work with your structure**: folders, tags, daily notes and templates, not a parallel filing system it invented.",
        ],
      },
      {
        heading: "Your key, your model, encrypted at rest",
        body: [
          "Nodum's assistant runs on a key you provide. Claude, OpenAI, Gemini and Qwen are all supported, keys are encrypted at rest, and a key can be set per vault — so a work vault and a personal vault need not share a provider or a bill.",
          "There is no per-seat AI upsell, because there is nothing to upsell: the software is MIT licensed and the model is yours. If you self-host and point it at a local model endpoint, no note ever leaves your network.",
        ],
      },
      {
        heading: "The other half: MCP, so your existing AI tools reach the vault",
        body: [
          "The assistant in the app is only one route in. Nodum is also a Model Context Protocol server at `/api/v1/mcp` — 36 tools over the same services and the same ownership checks the app uses. Point Claude Code, Claude Desktop or Cursor at it with a per-user token and the AI you already work in can create vaults, write and link notes, colour folders, search, import and export.",
          "Tokens are per-user, hashed, and revocable without touching your session, so handing an agent access is not the same as handing it your password. Long-running operations like an import report progress as they go.",
          "This is the part that makes an \"AI brain\" more than a phrase: the notes are a real store your other tools can read and write, not a chat window with a memory feature.",
        ],
      },
    ],
    checklist: {
      heading: "Questions to ask any AI note-taking app",
      items: [
        "Whose API key is it — mine, or theirs with a markup?",
        "Can I change model providers without changing apps?",
        "Can the assistant see my whole vault, or only the note that is open?",
        "When it writes a note, does it link into what already exists?",
        "Are my notes used to train anything?",
        "Can I self-host it and point it at a local model?",
        "Can my other AI tools reach the vault, or is the assistant the only door?",
      ],
    },
    faqs: [
      {
        question: "What is the best AI note-taking app?",
        answer:
          "It depends on whether you want the AI or the notes to be the product. Tools like Mem and Reflect build the assistant into a hosted, proprietary notebook. Nodum takes the other route: an open-source vault of plain markdown with an assistant that runs on your own API key, plus an MCP server so Claude Code, Claude Desktop or Cursor can work on the same notes.",
      },
      {
        question: "Can I use Claude or ChatGPT with my own notes?",
        answer:
          "Yes. Nodum's built-in assistant runs on a key you supply for Claude, OpenAI, Gemini or Qwen. Separately, Nodum is a Model Context Protocol server, so Claude Code, Claude Desktop and Cursor can connect directly with a revocable token and read, search, create and link notes in your vault using 36 tools.",
      },
      {
        question: "Is an AI second brain private?",
        answer:
          "That depends entirely on where the notes live. In Nodum, notes stay in your vault — on the hosted instance or on a server you run — and the assistant only sends what a request needs to the model provider you chose. Self-host it and point it at a local model endpoint and nothing leaves your network at all.",
      },
      {
        question: "Does AI replace linking notes yourself?",
        answer:
          "No, and it is worth being blunt about that. A model can suggest connections and Nodum surfaces semantically related notes using pgvector similarity over embeddings, but the act of deciding two ideas belong together is the thinking. Automating it away gives you a tidier vault and a worse understanding of your own material.",
      },
    ],
    related: [
      { label: "Second brain, defined", path: "/learn/second-brain" },
      { label: "Knowledge graphs", path: "/learn/knowledge-graph" },
      { label: "Open-source note-taking", path: "/learn/open-source-note-taking" },
      { label: "Obsidian alternative", path: "/alternatives/obsidian" },
    ],
  },
  {
    slug: "open-source-note-taking",
    rank: 3,
    eyebrow: "Open source",
    title: "Open-source note-taking: what the licence actually buys you",
    metaTitle: "Open source note taking app — the honest comparison",
    description:
      "Open source means the software outlives the company. Here is what to check, which open-source note apps are genuinely open, and where each one fits.",
    answer:
      "An open-source note-taking app is one whose source code is published under a licence that lets you read, modify, run and redistribute it. That matters for notes specifically, because a note archive is a decades-long asset: if the software is open, it can be forked and kept alive regardless of what happens to the people who wrote it.",
    keywords: [
      "open source note taking app",
      "open source note making tool",
      "open source notes app",
      "open source knowledge base",
      "open source alternative for obsidian",
      "open source obsidian alternative",
      "foss note taking",
      "free note taking app",
      "mit licensed notes app",
    ],
    sections: [
      {
        heading: "Open format is not the same as open source",
        body: [
          "This distinction gets blurred constantly, and it is the single most useful thing to be clear about. An open *format* means your data is readable without the vendor's software — markdown files in a folder, for instance. An open *source* means the software itself is published and can be run by anyone.",
          "Obsidian has the first and not the second: your vault is plain markdown on your disk, which is a genuinely strong data-ownership position, but the application is proprietary and its source is not published. If the project stops, you keep your files and lose your editor. Logseq, Joplin, Trilium, AppFlowy, AFFiNE, SilverBullet and Nodum have both.",
          "Which one you need depends on what you are protecting against. Open format protects your data. Open source protects your workflow.",
        ],
      },
      {
        heading: "MIT, AGPL, and source-available — the practical difference",
        body: [
          "Most open-source note apps sit in one of three buckets, and the differences are not academic.",
        ],
        bullets: [
          "**Permissive (MIT, Apache-2.0)** — do almost anything, including building a closed product on top. Nodum and AFFiNE are MIT; SilverBullet is MIT.",
          "**Copyleft (AGPL-3.0)** — you may run and modify it, but if you offer it as a network service you must publish your changes. Logseq, Joplin, Trilium and AppFlowy are AGPL. This is a deliberate choice to keep hosted forks open, and it is a real constraint if you intend to build commercially.",
          "**Source-available** — the code is readable but the licence restricts use, so it is not open source in the OSI sense even though it looks like it at a glance. Anytype has spent most of its life here.",
        ],
      },
      {
        heading: "The open-source options, honestly placed",
        body: [
          "There is no single winner, because these tools disagree about what a note is.",
        ],
        bullets: [
          "**Logseq** (AGPL) — local-first outliner, block references, flashcards. Best if you think in bullets.",
          "**Joplin** (AGPL) — notebooks, tags, end-to-end encrypted sync to storage you own, the best Evernote importer there is. Best if you are leaving Evernote.",
          "**Trilium / TriliumNext** (AGPL) — self-hosted, deep hierarchy, note cloning, a real scripting API. Best if you want to program your notes.",
          "**AppFlowy** (AGPL) and **AFFiNE** (MIT) — the Notion-shaped ones: pages, databases, and in AFFiNE's case an infinite canvas.",
          "**SilverBullet** (MIT) — the minimal self-hosted web PKM: one process over a folder of markdown, extended with Lua.",
          "**Nodum** (MIT) — browser-native, multi-tenant, Obsidian-compatible markdown with wikilinks, automatic backlinks, a GPU knowledge graph, collaboration, publishing and an MCP server.",
        ],
      },
      {
        heading: "What makes Nodum's position different",
        body: [
          "Nodum is MIT licensed end to end — the FastAPI backend and the Next.js frontend both — with no open-core split, no paid tier holding features back, and no contributor licence agreement assigning rights elsewhere. The repository is the product.",
          "It is also the open-source option that is web-native rather than a desktop app with a sync service bolted on. That is what makes it usable on a locked-down work laptop, a Chromebook, and a phone, all against the same vault. Self-hosting is one Docker Compose command that brings up the API, Postgres, Redis, MinIO and a Caddy edge with automatic TLS.",
          "And the exit is real: export gives you a folder-true zip of `.md` files — the same thing an Obsidian vault is — so choosing it does not commit you to it.",
        ],
      },
    ],
    checklist: {
      heading: "How to check an app is actually open source",
      items: [
        "Find the LICENSE file in the repository — not the marketing page.",
        "Check whether the licence is OSI-approved, or merely 'source available'.",
        "Check whether the *whole* product is open, or only a client while the server is proprietary.",
        "Look for an open-core split: are the features you need behind a paid, closed tier?",
        "Check the export path works before you need it.",
        "Check whether there is a self-hosting guide that someone has actually followed.",
      ],
    },
    faqs: [
      {
        question: "What is the best open-source note-taking app?",
        answer:
          "For local-first outlining, Logseq. For leaving Evernote, Joplin. For a self-hosted hierarchy with scripting, Trilium. For a Notion-shaped workspace, AppFlowy or AFFiNE. For browser-based linked notes with backlinks and a knowledge graph, Nodum — MIT licensed, self-hostable, and storing Obsidian-compatible markdown.",
      },
      {
        question: "Is Obsidian open source?",
        answer:
          "No. Obsidian is proprietary software. Its vault format is open — plain markdown files in a folder — but the application source is not published. Nodum is MIT licensed across both frontend and backend, which is why it can be forked, audited and self-hosted.",
      },
      {
        question: "Is there an open-source alternative to Obsidian?",
        answer:
          "Yes, several. Logseq is the closest local-first one. Nodum is the closest web-based one: it uses the same [[wikilink]] syntax, imports and exports Obsidian vaults as zips, and adds a GPU-rendered knowledge graph, collaboration and publishing — all under the MIT licence.",
      },
      {
        question: "Does open source mean free?",
        answer:
          "Usually in practice, but not by definition — open source is about rights, not price. Nodum is both: free to use and MIT licensed. If you self-host it, your only cost is the server it runs on.",
      },
    ],
    related: [
      { label: "Self-hosted notes", path: "/learn/self-hosted-notes" },
      { label: "Obsidian alternative", path: "/alternatives/obsidian" },
      { label: "Logseq alternative", path: "/alternatives/logseq" },
      { label: "All alternatives", path: "/alternatives" },
    ],
  },
  {
    slug: "note-taking-app",
    rank: 4,
    eyebrow: "Choosing a tool",
    title: "How to choose a note-taking app you will still be using in five years",
    metaTitle: "Note-taking app — how to choose one that lasts",
    description:
      "Every note-taking app demos well. The ones that last get four things right: capture speed, linking, plain-text ownership and a real export. A buyer's guide.",
    answer:
      "The best note-taking app is the one whose notes you can still open in ten years. Judge candidates on four things rather than feature lists: how fast capture is, whether notes link to each other and show the reverse link, whether the files are plain text you own, and whether export produces something another tool can read.",
    keywords: [
      "note taking app",
      "note making tool",
      "best note taking app",
      "best note making tool",
      "note taking software",
      "notes app",
      "digital notebook",
      "knowledge base software",
    ],
    sections: [
      {
        heading: "Feature lists are the wrong axis",
        body: [
          "Every note app in this category can do headings, checkboxes, tags and search. Comparing those is how people end up switching tools every eight months, because the differences that actually decide whether a system survives are structural, and structural properties do not photograph well in a feature table.",
          "There are four that matter, and they are worth more attention than the rest combined.",
        ],
      },
      {
        heading: "1. Capture has to be nearly free",
        body: [
          "The failure mode of every note system is the note you did not write. If capturing a thought means choosing a notebook, a template and a title, you will not do it while you are in the middle of something else — which is exactly when the thoughts worth keeping arrive.",
          "What good capture looks like: a keystroke that opens a search box which creates the note if nothing matches, a daily note that is always one command away, and a browser clipper for things you read. In Nodum that is ⌘O for the quick switcher, a daily note with your own template, and an MV3 Chrome clipper backed by a token that can only create notes.",
        ],
      },
      {
        heading: "2. Notes must link, in both directions",
        body: [
          "One-directional links are what every app has: a hyperlink from A to B. The useful part is the reverse — standing on note B and seeing that A, F and Q all reference it, with the sentence around each reference.",
          "This is the single feature that separates a note *collection* from a note *system*, and it is why the tools that have it — Obsidian, Logseq, Roam, Nodum — feel categorically different from the ones that do not. You get it for free at write time: type `[[Compound interest]]` and the backlink appears on the other side without any further work.",
        ],
      },
      {
        heading: "3. Plain text, or you are renting",
        body: [
          "If your notes are rows in a hosted database, your relationship with the vendor is a tenancy. Pricing changes, feature removals and acquisitions are all things that happen to tenants. Markdown files in folders are the format with the longest demonstrated shelf life and the widest tool support, and they are readable in a text editor when everything else has gone.",
          "This is not hypothetical: the largest waves of note-app migration in the last decade were triggered by pricing and ownership changes, not by better features appearing elsewhere.",
        ],
      },
      {
        heading: "4. Test the export before you need it",
        body: [
          "Export is the feature you evaluate on day one and use on the worst day. Import fifty notes into a candidate, export them, and look at what comes out. Does the folder structure survive? Do the links still point at anything? Is it markdown, or an XML dialect that needs a converter?",
          "Nodum's export is a folder-true zip of `.md` files — the same shape an Obsidian vault is, which is also what its importer accepts. That symmetry is deliberate: an import path that is not reversible is a trap, and a tool worth choosing should be one you can leave.",
        ],
      },
      {
        heading: "Where the main options land",
        body: [
          "Against those four criteria: Obsidian wins on ownership and plugins but is proprietary and desktop-only. Notion wins on databases and team work but stores blocks, not files. Evernote and OneNote are strong capture tools with no linking model. Logseq is excellent if you outline. Nodum is the browser-based, open-source one — markdown files, wikilinks, automatic backlinks, a knowledge graph, and an export that gives back exactly what you put in.",
        ],
      },
    ],
    checklist: {
      heading: "The five-minute evaluation",
      intro: "Do this with any candidate before you commit a single real note to it.",
      items: [
        "Time yourself capturing a thought from a cold start. More than five seconds is a problem.",
        "Link two notes. Then open the second one — can you see the first?",
        "Find where the files live. Can you open one in a text editor?",
        "Export everything and read the output. Would another app accept it?",
        "Open it on your second device, and on a machine you cannot install software on.",
        "Look up the licence. If the company disappears, what do you still have?",
      ],
    },
    faqs: [
      {
        question: "What is the best note-taking app?",
        answer:
          "For local markdown files and the largest plugin ecosystem, Obsidian. For team wikis and databases, Notion. For outlining with block references, Logseq. For an open-source, browser-based option with wikilinks, automatic backlinks and a knowledge graph that you can self-host, Nodum. All four keep notes in a form you can get back out.",
      },
      {
        question: "What is the best free note-taking app?",
        answer:
          "Obsidian's core app is free, Logseq is free and AGPL licensed, and Nodum is free and MIT licensed with no plan tiers. Nodum is the one that also runs in a browser and can be self-hosted, so it costs nothing beyond the server if you run your own.",
      },
      {
        question: "Should I use markdown for notes?",
        answer:
          "For anything you intend to keep, yes. Markdown is plain text, readable without special software, supported by every relevant tool, and has outlived several generations of proprietary note formats. The main thing it does not do well is complex layout and handwriting.",
      },
    ],
    related: [
      { label: "Second brain", path: "/learn/second-brain" },
      { label: "Open-source note-taking", path: "/learn/open-source-note-taking" },
      { label: "Markdown notes", path: "/learn/markdown-notes" },
      { label: "Compare every alternative", path: "/alternatives" },
    ],
  },
  {
    slug: "knowledge-graph",
    rank: 5,
    eyebrow: "The graph",
    title: "What a knowledge graph of your notes actually shows you",
    metaTitle: "Knowledge graph for notes — what it shows and why it matters",
    description:
      "A note graph is not decoration. It shows clusters you didn't plan, orphans you forgot, and the gaps between the things you know. How to read one, and use it.",
    answer:
      "A knowledge graph of your notes draws every note as a node and every link as an edge, then lets physics arrange it. It is useful for three specific things: finding clusters of thinking you did not plan, spotting orphaned notes nothing references, and seeing which two areas of your work have never once been connected.",
    keywords: [
      "knowledge graph",
      "knowledge graph notes",
      "note graph view",
      "obsidian graph view",
      "node graph notes",
      "node based note taking",
      "networked thought",
      "linked notes",
    ],
    sections: [
      {
        heading: "Why a graph and not a folder tree",
        body: [
          "A folder tree encodes one relationship: containment. It answers \"what is inside what\", which is a question you rarely have. A graph encodes the relationship you actually care about — \"what is connected to what\" — and because a note can link to any number of others, it does not force the single-category decision that folders do.",
          "The tree is still useful for storage. The graph is what you use for thinking.",
        ],
      },
      {
        heading: "Three things a graph tells you that search cannot",
        body: [],
        bullets: [
          "**Clusters you did not plan.** After a few hundred notes, dense regions appear where you have been thinking hardest. They are usually not the topics you would have listed if asked.",
          "**Orphans.** Notes nothing links to and which link to nothing. Some are fine — a shopping list is not supposed to be connected. Others are ideas you captured and then abandoned, and seeing them is often the prompt to do something with them.",
          "**Structural holes.** Two dense clusters with no edge between them means two bodies of your own knowledge that have never been brought into contact. That gap is frequently where the interesting work is.",
        ],
      },
      {
        heading: "Reading a graph properly",
        body: [
          "A few conventions make one legible rather than pretty. Node size by degree — how many notes link to it — puts your hub notes visually forward. Colour by folder or tag turns the graph into a map of your own categories rather than an undifferentiated hairball. And a local graph, showing only the neighbours of the note you are in at an adjustable depth, is often more useful day to day than the global one.",
          "Ghost nodes are the underrated part: links to notes that do not exist yet, drawn as hollow nodes. They are a to-do list made of your own intentions, and in Nodum clicking one creates the note with the backlink already resolved.",
        ],
      },
      {
        heading: "The engineering, briefly",
        body: [
          "Force-directed layout is expensive — every node repels every other node — and most graph views quietly stop being usable somewhere in the low thousands. Nodum renders the graph on WebGL2 through `@cosmos.gl/graph`, running the force simulation on the GPU, which is what keeps it smooth into the tens of thousands of notes.",
          "The interaction matters as much as the frame rate: draggable nodes, hover highlighting of neighbours, live force sliders for centre, repulsion, link force and link distance, search and tag filters, and labels that fade with zoom. There is also a guard so that a lost WebGL context — which browsers do, unprompted — cannot take the workspace down with it.",
          "Graph data is cached in Redis and invalidated on note and link writes, so opening the graph on a large vault does not mean recomputing it.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is a knowledge graph in a note-taking app?",
        answer:
          "It is a visualisation where each note is a node and each link between notes is an edge, arranged by a force simulation so connected notes pull together. It shows clusters, orphaned notes and gaps between topics — structural information about your notes that search cannot surface.",
      },
      {
        question: "Is the graph view actually useful, or just decorative?",
        answer:
          "It is genuinely useful for three things: finding clusters of thinking you did not plan, spotting notes nothing references, and noticing two areas of your work that have never been linked. It is not useful for navigation — search and a quick switcher are faster for getting to a specific note.",
      },
      {
        question: "How many notes can a graph view handle?",
        answer:
          "Most implementations degrade in the low thousands because force-directed layout is quadratic in the number of nodes. Nodum runs the simulation on the GPU via WebGL2, which keeps it interactive into the tens of thousands of notes.",
      },
    ],
    related: [
      { label: "Backlinks and wikilinks", path: "/learn/backlinks" },
      { label: "Second brain", path: "/learn/second-brain" },
      { label: "Zettelkasten", path: "/learn/zettelkasten" },
      { label: "Obsidian alternative", path: "/alternatives/obsidian" },
    ],
  },
  {
    slug: "backlinks",
    rank: 6,
    eyebrow: "Links",
    title: "Backlinks and wikilinks: the mechanic that turns notes into a system",
    metaTitle: "Backlinks and wikilinks — how bidirectional linking works",
    description:
      "A wikilink is what you type. A backlink is what you get for free. Here's how bidirectional linking works, why it changes note-taking, and the syntax.",
    answer:
      "A wikilink is a link you write as `[[Note title]]`. A backlink is the automatic reverse: when note A links to note B, note B shows that A references it, with the surrounding sentence for context. You write links in one direction and the system maintains both, which is what makes linking cheap enough to actually do.",
    keywords: [
      "backlinks",
      "backlinks notes app",
      "wikilinks",
      "bidirectional links",
      "linked notes",
      "unlinked mentions",
      "wiki link syntax",
    ],
    sections: [
      {
        heading: "The syntax",
        body: [
          "Wikilink syntax came from wikis and was popularised for personal notes by Roam and Obsidian. It is deliberately tiny, because a link you have to think about is a link you will not make.",
        ],
        bullets: [
          "`[[Note title]]` — link by title. Autocomplete usually fires on the second bracket.",
          "`[[folder/Note title]]` — link by path when two notes share a title.",
          "`[[Note title|what to call it here]]` — an alias, so the sentence still reads properly.",
          "`[[Note title#Heading]]` — jump to a specific heading in the target note.",
          "`![[Note title]]` — embed the note's content inline rather than linking to it.",
          "`![[image.png]]` — embed an attachment.",
        ],
      },
      {
        heading: "Why the reverse direction is the point",
        body: [
          "Writing a link is a decision you make once, in one place, while writing. Maintaining the reverse by hand is work you would never keep up, which is why manually cross-referenced note systems collapse: the index goes stale and stops being trustworthy.",
          "Automatic backlinks remove that cost entirely. The consequence is behavioural rather than technical — because linking is free, you link far more, and the network gets dense enough to be genuinely useful. A note-taking system's value is roughly the square of how connected it is, and connection is bounded by how much effort each link costs.",
        ],
      },
      {
        heading: "Unlinked mentions, and links to notes that don't exist",
        body: [
          "Two related features do most of the remaining work. **Unlinked mentions** find places where a note's title appears as plain text without being a link — usually things you wrote before that note existed. Turning them into links is often the fastest way to densify an old vault.",
          "**Unresolved links** are the other direction: `[[A note I have not written]]` is valid, and it appears in the graph as a ghost node. This turns out to be a good way to work — write the link while the thought is live, create the note later. In Nodum, clicking the ghost node creates the note and the backlink resolves on the spot.",
        ],
      },
      {
        heading: "How Nodum implements it",
        body: [
          "Link extraction happens server-side on every save, writing into a `links` table with source, target and an unresolved flag. That is what makes backlinks, unlinked mentions, the graph and the orphan filter all query-cheap rather than something recomputed by scanning files.",
          "The backlinks pane shows linked mentions with a context snippet, unlinked mentions, and outgoing links, on every note. Because links live in a table rather than being parsed on demand, renaming a note or importing a vault of two hundred notes resolves links across the whole batch rather than file by file.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is a backlink in a note-taking app?",
        answer:
          "A backlink is the automatic reverse of a link you wrote. If note A contains `[[Note B]]`, then note B displays that A references it — usually with the sentence around the link for context. You maintain one direction; the app maintains the other.",
      },
      {
        question: "What is the difference between a wikilink and a markdown link?",
        answer:
          "A markdown link, `[text](path/to/file.md)`, points at a file path and breaks when the file moves. A wikilink, `[[Note title]]`, points at a note by title and is resolved by the app, so it survives moves and renames and can be created before the target note exists.",
      },
      {
        question: "What are unlinked mentions?",
        answer:
          "Places where a note's title appears as plain text somewhere else in the vault without being a link. They are usually text written before the note existed. Reviewing them and converting the relevant ones into real links is the quickest way to connect an existing collection of notes.",
      },
    ],
    related: [
      { label: "Knowledge graph", path: "/learn/knowledge-graph" },
      { label: "Zettelkasten", path: "/learn/zettelkasten" },
      { label: "Markdown notes", path: "/learn/markdown-notes" },
      { label: "Second brain", path: "/learn/second-brain" },
    ],
  },
  {
    slug: "zettelkasten",
    rank: 7,
    eyebrow: "Method",
    title: "Zettelkasten, without the mystique",
    metaTitle: "Zettelkasten app — the method, and how to run it digitally",
    description:
      "Luhmann's slip-box in plain terms: atomic notes in your own words, linked to each other, with an entry point. What survives the move to software, and what doesn't.",
    answer:
      "A Zettelkasten is a note system with three rules: one idea per note, written in your own words, and linked to the notes it relates to rather than filed under a topic. Niklas Luhmann kept his on paper index cards. Digitally, the method needs cheap linking, stable note identity and a way back in — which is what wikilinks, backlinks and index notes provide.",
    keywords: [
      "zettelkasten",
      "zettelkasten app",
      "digital zettelkasten",
      "slip box method",
      "atomic notes",
      "evergreen notes",
      "luhmann note taking",
    ],
    sections: [
      {
        heading: "The three rules, and why each one is there",
        body: [],
        bullets: [
          "**One idea per note.** Atomic notes can be linked precisely and reused in contexts you did not anticipate. A note containing six ideas can only ever be linked as a lump.",
          "**In your own words.** Rewriting forces comprehension. A note that is a quotation is a bookmark; a note that is your restatement is a thought you have actually had. This is the rule people skip and the reason their system feels inert.",
          "**Linked, not filed.** Rather than assigning a category, you connect the note to the existing notes it argues with, extends or contradicts. The structure is emergent — it is the record of what you noticed, not a taxonomy you invented in advance.",
        ],
      },
      {
        heading: "What Luhmann's numbering was actually for",
        body: [
          "Luhmann's famous alphanumeric ids — 21/3d7a6 — get treated as the heart of the method. They were a workaround. On paper, a new card had to be physically placed somewhere, and the numbering let him insert a card *next to* the one it responded to without renumbering the box.",
          "Software removes the constraint entirely: a link is a link regardless of where a note sits. Reproducing Luhmann's ids in a digital system is cargo cult. Keep the atomicity, the rewriting and the linking; drop the numbering.",
        ],
      },
      {
        heading: "Fleeting, literature, permanent",
        body: [
          "The three-tier distinction is worth keeping because it prevents the most common failure: a slip-box full of quotations nobody will ever reread.",
          "**Fleeting notes** are captures — a thought on a walk, a line from a conversation. They are disposable and should be processed within days. **Literature notes** record what a source said, in your words, with the citation. **Permanent notes** are the actual Zettelkasten: one idea, your own claim, linked into the network. The work is the promotion from one tier to the next, and skipping it produces a very tidy archive of things you have not thought about.",
        ],
      },
      {
        heading: "Index notes and the way back in",
        body: [
          "A network with no entry points is unusable. Luhmann kept hub cards pointing into each line of thought; the digital equivalent is variously called an index note, a structure note or a map of content. It is a note whose body is mostly links, curated by hand, describing a region of the vault.",
          "Build them when a cluster gets big enough to be hard to hold in your head — not before. A map of content written on day one is a folder hierarchy wearing a different hat.",
        ],
      },
      {
        heading: "Running one in Nodum",
        body: [
          "Practically: one note per idea, titled as the claim it makes rather than the topic it covers ('Compound interest rewards patience more than accuracy' beats 'Compound interest'). Link with `[[` as you write. Let the backlinks pane show you what already argues with the note you are on. Use tags for state — `#fleeting`, `#literature`, `#permanent` — rather than for topics, since topics are what links are for.",
          "The graph earns its place here specifically: orphans are notes you captured and never thought about again, and dense clusters with no edge between them are two lines of thought that have never met.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is a Zettelkasten?",
        answer:
          "A Zettelkasten — German for 'slip box' — is a note-taking method built on atomic notes: one idea per note, written in your own words, and linked to related notes rather than filed by topic. It was made famous by the sociologist Niklas Luhmann, who used it to write a very large body of work from a box of index cards.",
        },
      {
        question: "What is the best app for a digital Zettelkasten?",
        answer:
          "Any app with cheap wikilinks and automatic backlinks will do: Obsidian, Logseq, Roam and Nodum all qualify. Nodum is the open-source, browser-based option — MIT licensed, plain markdown, wikilinks with autocomplete, automatic backlinks with context, and a knowledge graph for spotting orphans and clusters.",
      },
      {
        question: "Do I need Luhmann's numbering system?",
        answer:
          "No. The alphanumeric ids solved a physical problem — inserting a card next to a related one without renumbering the box. In software, links do that directly. Keep the atomic notes, the rewriting in your own words, and the linking; the numbering adds nothing.",
      },
    ],
    related: [
      { label: "Second brain", path: "/learn/second-brain" },
      { label: "Backlinks and wikilinks", path: "/learn/backlinks" },
      { label: "Knowledge graph", path: "/learn/knowledge-graph" },
      { label: "Personal knowledge management", path: "/learn/personal-knowledge-management" },
    ],
  },
  {
    slug: "personal-knowledge-management",
    rank: 8,
    eyebrow: "PKM",
    title: "Personal knowledge management, minus the productivity theatre",
    metaTitle: "Personal knowledge management (PKM) — a practical guide",
    description:
      "PKM is capture, connect, retrieve. Most systems fail at the connecting step. A practical guide to the methods, the tools, and what actually matters.",
    answer:
      "Personal knowledge management is the practice of capturing what you learn, connecting it to what you already know, and retrieving it when it is relevant. Most systems fail at the middle step: capture is easy and search is built in, but connection requires either deliberate linking or it does not happen at all.",
    keywords: [
      "personal knowledge management",
      "pkm",
      "pkm app",
      "knowledge management software",
      "para method",
      "note taking system",
      "knowledge worker notes",
    ],
    sections: [
      {
        heading: "Three steps, and the one everyone skips",
        body: [
          "PKM decomposes cleanly into capture, connect and retrieve. Capture is a solved problem — every app has a new-note button, a clipper and a mobile share sheet. Retrieve is mostly solved too, because full-text search is cheap and good.",
          "Connect is where systems die. It is the only step that requires you to do something at the moment of writing that pays off months later, and it is therefore the step that gets dropped first. Everything else in a PKM setup — methods, templates, tag taxonomies — is downstream of whether connection actually happens.",
        ],
      },
      {
        heading: "The methods, briefly and fairly",
        body: [],
        bullets: [
          "**PARA** (Projects, Areas, Resources, Archive) organises by actionability rather than subject. Excellent for work you are actively doing; weaker as a long-term thinking archive, because 'archive' is where ideas go quiet.",
          "**Zettelkasten** organises by links between atomic notes. Excellent for developing ideas over years; poor at tracking what is due on Thursday.",
          "**Johnny.Decimal** imposes a strict numbered hierarchy. Excellent for shared team filing; it is a filing system, not a thinking system.",
          "**Evergreen notes** — Andy Matuschak's formulation — emphasises notes that are rewritten and improved over time rather than appended to. The most useful single idea to take from any of them.",
        ],
      },
      {
        heading: "What to actually do",
        body: [
          "The honest advice is unglamorous. Pick a tool with cheap linking and a real export. Write notes titled as claims rather than topics. Link while writing, never in a later 'processing' session that will not happen. Review the orphans occasionally. Do not build a taxonomy before you have the notes to justify it.",
          "Most people's PKM problem is not that they picked the wrong method. It is that they spent the first three weeks configuring the system and then never wrote in it.",
        ],
      },
      {
        heading: "What a PKM tool needs to provide",
        body: [
          "Reduced to essentials: a fast capture path, wikilinks with autocomplete, automatic backlinks with context, full-text search with operators, tags that nest, daily notes, and an export that produces plain files. A graph is valuable but secondary — it is a review tool, not a daily one.",
          "Nodum provides all of those: quick switcher on ⌘O that creates the note if nothing matches, `[[` autocomplete across the vault, a backlinks pane with linked and unlinked mentions, Postgres full-text search with `path:`, `file:` and `tag:` operators and quoted phrases, nested tags with counts, configurable daily notes and templates, server-side version history on every save, and a folder-true markdown export.",
        ],
      },
    ],
    faqs: [
      {
        question: "What is personal knowledge management?",
        answer:
          "Personal knowledge management (PKM) is the practice of capturing information you encounter, connecting it to what you already know, and retrieving it when relevant. The connecting step — usually done with links between notes — is what distinguishes it from simply keeping files.",
      },
      {
        question: "What is the best PKM app?",
        answer:
          "Obsidian for local markdown files and plugins, Logseq for outlining, Notion for team wikis, and Nodum for an open-source browser-based option with wikilinks, automatic backlinks, a knowledge graph and self-hosting. The choice matters less than picking one with cheap linking and a real export, then writing in it.",
      },
      {
        question: "PARA or Zettelkasten?",
        answer:
          "They solve different problems and can coexist. PARA organises by actionability and suits project work; Zettelkasten organises by links between atomic notes and suits developing ideas over years. A common arrangement is PARA folders for active work and a linked, atomic note network underneath it.",
      },
    ],
    related: [
      { label: "Zettelkasten", path: "/learn/zettelkasten" },
      { label: "Second brain", path: "/learn/second-brain" },
      { label: "Choosing a note-taking app", path: "/learn/note-taking-app" },
      { label: "Knowledge graph", path: "/learn/knowledge-graph" },
    ],
  },
  {
    slug: "self-hosted-notes",
    rank: 9,
    eyebrow: "Self-hosting",
    title: "Self-hosted notes: what it costs, what it buys, and how to run one",
    metaTitle: "Self-hosted notes app — run your own knowledge base",
    description:
      "Self-hosting your notes means no vendor, no seat pricing and no exit risk — in exchange for a server you maintain. What it takes, and how Nodum deploys.",
    answer:
      "Self-hosting a notes app means running the server yourself, so your notes sit on infrastructure you control and no vendor can reprice, restrict or discontinue them. The cost is real but small: a modest VPS, a domain, and occasional maintenance. Nodum self-hosts with one Docker Compose command including automatic TLS.",
    keywords: [
      "self hosted notes app",
      "self hosted knowledge base",
      "self hosted obsidian",
      "docker note taking app",
      "host your own notes",
      "private notes app",
      "no lock in notes",
    ],
    sections: [
      {
        heading: "What self-hosting actually buys",
        body: [
          "Three things, and it is worth being precise because self-hosting is often sold on vaguer grounds. First, **continuity**: the software cannot be discontinued out from under you, because you have the source and the running copy. Second, **privacy in the strong sense**: your notes are on your disk, not covered by someone else's terms of service. Third, **cost shape**: a flat server bill rather than per-seat pricing that scales with your team.",
          "What it does not buy is zero effort. You are now the operator: backups, updates and TLS renewal are yours.",
        ],
      },
      {
        heading: "What it costs, honestly",
        body: [
          "A single-user Nodum instance runs comfortably on a small VPS — the stack is Postgres, Redis, MinIO, the FastAPI API and the Next.js frontend behind Caddy. That is more moving parts than a single-binary app like SilverBullet, and it is the right trade only if you want what the extra parts provide: full-text search, a cached graph, attachments in object storage, background import and export jobs.",
          "Budget an evening for the first deployment and an hour a quarter afterwards. If that sounds like too much, the hosted instance exists for exactly that reason, and you can move between them with an export and an import.",
        ],
      },
      {
        heading: "How Nodum deploys",
        body: [
          "The whole stack is containerised, edge proxy included:",
        ],
        bullets: [
          "`cp deploy/.env.prod.example deploy/.env.prod`, fill it in, `chmod 600` it.",
          "`cd deploy && ./compose.sh prod up -d --build`.",
          "Caddy terminates TLS and provisions and renews certificates automatically, proxies `/api` to the API and `/s3` to MinIO for presigned attachment URLs.",
          "Caddy is the only container that binds a host port — Postgres and Redis are not even on its network.",
          "Schema changes run in a one-shot `migrate` container everything else waits on, so no two containers race Alembic.",
          "`./smoke.sh https://your-domain` drives signup → note → attachment through the real proxy chain to prove the deployment works.",
        ],
      },
      {
        heading: "The things people forget",
        body: [
          "**Backups.** A self-hosted note archive with no backup is worse than a hosted one, not better. Nodum ships a backup and restore runbook; the short version is a scheduled `pg_dump` plus the MinIO bucket, stored somewhere that is not the same machine.",
          "**Updates.** Pull, rebuild, let the migrate container run. Read the release notes first.",
          "**Refusing to boot on defaults.** The API deliberately refuses to start on placeholder or known-default credentials, in staging as well as production. This is an annoyance exactly once and a saved incident afterwards.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can I self-host Obsidian?",
        answer:
          "Not the application itself — Obsidian is a proprietary local app, though you can self-host sync by pointing the vault folder at your own Syncthing, Git or WebDAV setup. If you want a server-based knowledge base you actually run, Nodum, SilverBullet, Trilium and Joplin Server are the open-source options.",
      },
      {
        question: "What do I need to self-host Nodum?",
        answer:
          "A machine with Docker or Podman, a domain name pointed at it, and about an evening. The compose stack brings up Postgres, Redis, MinIO, the API, the web frontend and a Caddy edge proxy that provisions TLS certificates automatically. A small VPS is sufficient for personal use.",
      },
      {
        question: "Is self-hosting more private?",
        answer:
          "It is more private in the sense that matters most: the notes are on hardware you control and are not covered by a third party's terms. It is only more secure if you actually maintain it — an unpatched server you run is worse than a maintained service someone else runs.",
      },
    ],
    related: [
      { label: "Open-source note-taking", path: "/learn/open-source-note-taking" },
      { label: "SilverBullet alternative", path: "/alternatives/silverbullet" },
      { label: "Trilium alternative", path: "/alternatives/trilium" },
      { label: "Choosing a note-taking app", path: "/learn/note-taking-app" },
    ],
  },
  {
    slug: "markdown-notes",
    rank: 10,
    eyebrow: "Markdown",
    title: "Why notes should be markdown files",
    metaTitle: "Markdown notes app — why plain text outlives everything else",
    description:
      "Markdown is the only note format with a demonstrated multi-decade shelf life. What it does well, where it breaks down, and what a good markdown editor gives you.",
    answer:
      "Markdown is plain text with a light convention for structure, readable without any special software and supported by essentially every tool that handles text. For notes it is the format with the longest demonstrated shelf life: a markdown file written today opens correctly in a text editor in twenty years, which is not true of any proprietary note format.",
    keywords: [
      "markdown notes app",
      "markdown knowledge base",
      "plain text notes",
      "markdown editor browser",
      "live preview markdown",
      "obsidian markdown syntax",
    ],
    sections: [
      {
        heading: "The argument in one line",
        body: [
          "Your notes will outlive the app you wrote them in. Every proprietary note format in history has eventually needed a converter, and every converter loses something. Plain text does not have this problem, because the file *is* the content.",
          "Markdown adds just enough convention on top — headings, emphasis, lists, links, code — to be structured without stopping being readable when nothing renders it.",
        ],
      },
      {
        heading: "Where markdown genuinely falls down",
        body: [
          "It is worth being honest about the limits, because the format is often oversold. Markdown has no good story for complex tables, precise layout, handwriting, or anything spatial. There is no single standard — CommonMark, GFM and various dialects disagree on details — so a document can render differently in two tools. And extensions for maths, diagrams and callouts are conventions rather than specification, so portability is partial.",
          "If your notes are mostly handwritten, mostly visual, or mostly structured records, markdown is the wrong hammer and something like OneNote, Heptabase or a database tool will serve you better.",
        ],
      },
      {
        heading: "What a good markdown editor should do",
        body: [
          "Raw markdown with a rendered preview beside it is the old model and it splits your attention. Live preview — where syntax hides as you write and reveals when your cursor enters it — is what makes markdown feel like writing rather than marking up.",
          "Nodum uses CodeMirror 6, the same editor engine Obsidian uses, with three modes: live preview, raw source, and reading view, cycled with ⌘E. Headings size themselves, emphasis renders, task checkboxes are clickable, code fences highlight, and the syntax reappears exactly where you are typing.",
        ],
      },
      {
        heading: "The extensions worth having",
        body: [],
        bullets: [
          "**Wikilinks** — `[[Note]]`, with autocomplete, aliases, heading targets and embeds.",
          "**Callouts** — `> [!note]`, `> [!warning]` and the rest of the Obsidian set, with icons, colours and folding.",
          "**Maths** — inline `$..$` and block `$$..$$` rendered with KaTeX.",
          "**Diagrams** — Mermaid in fenced blocks.",
          "**Frontmatter** — YAML at the top of the file for properties, tags, aliases and dates.",
          "**Tables** — GFM tables, ideally with real cell editing rather than hand-aligning pipes.",
        ],
      },
    ],
    faqs: [
      {
        question: "Why use markdown for notes instead of a rich-text editor?",
        answer:
          "Because a markdown file is plain text: it opens in any editor, on any operating system, without the original application. Rich-text and proprietary note formats need their own software to be read, which makes them a liability for anything you intend to keep for years.",
      },
      {
        question: "What is live preview in a markdown editor?",
        answer:
          "Live preview renders markdown in place as you write — headings size themselves, bold text appears bold — while revealing the raw syntax on the line your cursor is on. It replaces the older split-screen model where you edit raw markdown on one side and read a preview on the other.",
      },
      {
        question: "Does Nodum use the same markdown as Obsidian?",
        answer:
          "Largely yes. Nodum supports Obsidian's wikilink syntax including paths, aliases, heading targets and embeds, the full callout set, YAML frontmatter, KaTeX maths, Mermaid diagrams, GFM tables and footnotes. Obsidian vaults import as zips and export back in the same shape.",
      },
    ],
    related: [
      { label: "Backlinks and wikilinks", path: "/learn/backlinks" },
      { label: "Obsidian alternative", path: "/alternatives/obsidian" },
      { label: "Choosing a note-taking app", path: "/learn/note-taking-app" },
      { label: "Open-source note-taking", path: "/learn/open-source-note-taking" },
    ],
  },
];

export const TOPICS_BY_RANK = [...TOPICS].sort((a, b) => a.rank - b.rank);

export function getTopic(slug: string): Topic | undefined {
  return TOPICS.find((t) => t.slug === slug);
}

export const TOPIC_SLUGS = TOPICS.map((t) => t.slug);
