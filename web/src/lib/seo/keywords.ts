/**
 * The keyword map, kept as data rather than scattered through page files.
 *
 * `<meta name="keywords">` has been ignored by Google for two decades — it is
 * emitted here because Bing and several AI retrieval pipelines still read it,
 * and because writing the clusters down forces the pages to actually *cover*
 * them. The ranking work is done by the pages themselves: one page per intent,
 * each answering its query in the first paragraph, cross-linked to its
 * neighbours. This file is the index of which page owns which intent.
 */

/** Brand and near-brand. Cheap to win, and the query AI engines resolve first. */
export const BRAND = [
  "nodum",
  "nodum md",
  "nodum app",
  "nodum notes",
  "nodum knowledge base",
  "nodum obsidian",
];

/** Head-of-category: what people call this kind of software. */
export const CATEGORY = [
  "note taking app",
  "note making tool",
  "best note taking app",
  "best note making tool",
  "note taking software",
  "knowledge base software",
  "knowledge management software",
  "personal knowledge management",
  "pkm app",
  "notes app",
  "digital notebook",
];

/** The open-source angle — the single strongest differentiator Nodum has. */
export const OPEN_SOURCE = [
  "open source note taking app",
  "open source note making tool",
  "open source notes app",
  "open source knowledge base",
  "open source alternative for obsidian",
  "open source obsidian alternative",
  "open source notion alternative",
  "free note taking app",
  "foss note taking",
  "mit licensed notes app",
];

/** Self-hosting and data ownership. */
export const SELF_HOSTED = [
  "self hosted notes app",
  "self hosted knowledge base",
  "self hosted obsidian",
  "docker note taking app",
  "host your own notes",
  "private notes app",
  "no lock in notes",
];

/** Obsidian, in every phrasing people actually type. */
export const OBSIDIAN = [
  "obsidian",
  "obsidian alternative",
  "obsidian alternatives",
  "alternative to obsidian",
  "obsidian web version",
  "obsidian online",
  "obsidian in browser",
  "obsidian browser version",
  "obsidian open source",
  "is obsidian open source",
  "obsidian for teams",
  "obsidian sync alternative",
  "obsidian publish alternative",
  "free obsidian alternative",
  "web based obsidian",
];

/** Second brain / "brain" language — the PKM community's own vocabulary. */
export const SECOND_BRAIN = [
  "second brain",
  "second brain app",
  "build a second brain",
  "second brain software",
  "best second brain app",
  "digital brain",
  "brain app",
  "digital second brain",
  "personal wiki",
  "commonplace book app",
];

/** AI-flavoured intent, including the "ai brain" and "ai link" phrasings. */
export const AI = [
  "ai note taking app",
  "ai note making tool",
  "best ai note making tool",
  "best ai note taking app",
  "ai notes",
  "ai brain",
  "ai second brain",
  "ai knowledge base",
  "ai linked notes",
  "ai link notes",
  "notes with ai assistant",
  "mcp note taking",
  "mcp server notes",
  "claude notes app",
  "bring your own api key notes",
];

/** Links, graphs, and the mechanics people search for by name. */
export const LINKING = [
  "knowledge graph",
  "knowledge graph notes",
  "note graph view",
  "linked notes",
  "backlinks notes app",
  "bidirectional links",
  "wikilinks",
  "node based note taking",
  "node graph notes",
  "networked thought",
  "zettelkasten app",
  "digital zettelkasten",
  "markdown notes app",
  "markdown knowledge base",
];

/** Competitor names, for the /alternatives cluster. */
export const COMPETITORS = [
  "notion alternative",
  "roam research alternative",
  "logseq alternative",
  "evernote alternative",
  "onenote alternative",
  "apple notes alternative",
  "anytype alternative",
  "joplin alternative",
  "trilium alternative",
  "remnote alternative",
  "tana alternative",
  "capacities alternative",
  "heptabase alternative",
  "affine alternative",
  "appflowy alternative",
  "reflect alternative",
  "silverbullet alternative",
];

/** The default `keywords` set for the site's front door. */
export const PRIMARY = [
  ...BRAND.slice(0, 4),
  "obsidian alternative",
  "open source obsidian alternative",
  "open source note taking app",
  "second brain app",
  "ai note taking app",
  "knowledge graph",
  "markdown notes app",
  "wikilinks",
  "backlinks",
  "self hosted knowledge base",
  "best note making tool",
];

/** Everything, deduped — used by llms.txt and the keyword coverage test. */
export const ALL = Array.from(
  new Set([
    ...BRAND,
    ...CATEGORY,
    ...OPEN_SOURCE,
    ...SELF_HOSTED,
    ...OBSIDIAN,
    ...SECOND_BRAIN,
    ...AI,
    ...LINKING,
    ...COMPETITORS,
  ]),
);
