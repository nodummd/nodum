/**
 * Schema.org builders.
 *
 * Two audiences read this output and they want different things. Google wants
 * valid types it can turn into a rich result (SoftwareApplication, FAQPage,
 * BreadcrumbList). The generative engines — AI Overviews, ChatGPT Search,
 * Perplexity, Claude — use it as a fact table: it is how they learn that
 * "Nodum" is a piece of software, that it is free, that it is MIT licensed and
 * that it is *the same entity* being talked about on twenty other pages.
 *
 * Hence the `@id` discipline: the organisation, the website and the
 * application are declared once in the root layout and referenced by id
 * everywhere else, so the graph resolves to three entities rather than sixty
 * unrelated copies.
 */

import {
  GITHUB_URL,
  ID,
  LICENSE_URL,
  LOGO_PATH,
  OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  SOCIAL_PROFILES,
  absolute,
} from "./site";

/** A JSON-LD node. Loose by design — schema.org is not a closed vocabulary. */
export type Thing = Record<string, unknown>;

/** Wrap nodes in a single `@graph` so one <script> carries the whole page. */
export function graph(...nodes: Thing[]): Thing {
  return { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) };
}

/** Declared once, in the root layout. Everything else points at `ID.organization`. */
export function organization(): Thing {
  return {
    "@type": "Organization",
    "@id": ID.organization,
    name: SITE_NAME,
    alternateName: "Nodum — linked notes, living graph",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: absolute(LOGO_PATH), width: 512, height: 512 },
    description: SITE_DESCRIPTION,
    sameAs: SOCIAL_PROFILES,
  };
}

/**
 * The WebSite node, with the search action that makes the docs searchable
 * straight from a search result.
 */
export function website(): Thing {
  return {
    "@type": "WebSite",
    "@id": ID.website,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": ID.organization },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/docs?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * The product itself. `offers` at price 0 is not a gimmick — "is it free?" is
 * one of the highest-volume qualifiers in this category, and a machine-readable
 * zero is what makes an AI answer say "free and open source" rather than hedge.
 */
export function softwareApplication({
  version,
  features,
}: {
  version: string;
  features: readonly string[];
}): Thing {
  return {
    "@type": "SoftwareApplication",
    "@id": ID.software,
    name: SITE_NAME,
    applicationCategory: "ProductivityApplication",
    applicationSubCategory: "Knowledge Management",
    operatingSystem: "Web browser, Linux, macOS, Windows (self-hosted via Docker)",
    softwareVersion: version,
    url: SITE_URL,
    downloadUrl: GITHUB_URL,
    installUrl: `${SITE_URL}/signup`,
    softwareHelp: { "@type": "CreativeWork", url: `${SITE_URL}/docs` },
    license: LICENSE_URL,
    isAccessibleForFree: true,
    image: absolute(OG_IMAGE),
    screenshot: absolute("/workspace.jpg"),
    description: SITE_DESCRIPTION,
    featureList: [...features],
    offers: {
      "@type": "Offer",
      price: 0,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      category: "Free and open source",
    },
    author: { "@id": ID.organization },
    publisher: { "@id": ID.organization },
    maintainer: { "@id": ID.organization },
  };
}

/** A page-level node that ties the page to the site and its breadcrumb. */
export function webPage({
  path,
  name,
  description,
  breadcrumbId,
  datePublished,
  dateModified,
  primaryImage,
}: {
  path: string;
  name: string;
  description: string;
  breadcrumbId?: string;
  datePublished?: string;
  dateModified?: string;
  primaryImage?: string;
}): Thing {
  const url = absolute(path);
  return {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": ID.website },
    about: { "@id": ID.software },
    ...(breadcrumbId ? { breadcrumb: { "@id": breadcrumbId } } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(primaryImage
      ? { primaryImageOfPage: { "@type": "ImageObject", url: absolute(primaryImage) } }
      : {}),
  };
}

/** Trail of `{ name, path }`, root first. Returns a node plus its `@id`. */
export function breadcrumbs(trail: { name: string; path: string }[]): Thing {
  const last = trail[trail.length - 1];
  return {
    "@type": "BreadcrumbList",
    "@id": `${absolute(last.path)}#breadcrumb`,
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: absolute(step.path),
    })),
  };
}

export function breadcrumbId(path: string): string {
  return `${absolute(path)}#breadcrumb`;
}

/**
 * FAQPage. The highest-leverage schema for generative search: a question and a
 * self-contained answer is exactly the unit an AI engine quotes. Answers should
 * read as complete sentences with the subject named, never "It does" — the
 * quote travels without the question attached.
 */
export interface Faq {
  question: string;
  answer: string;
}

export function faqPage(path: string, faqs: readonly Faq[]): Thing {
  return {
    "@type": "FAQPage",
    "@id": `${absolute(path)}#faq`,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

/** Docs articles and guides. */
export function article({
  path,
  headline,
  description,
  datePublished,
  dateModified,
  section,
  image,
}: {
  path: string;
  headline: string;
  description: string;
  datePublished?: string;
  dateModified?: string;
  section?: string;
  image?: string;
}): Thing {
  const url = absolute(path);
  return {
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline,
    description,
    url,
    inLanguage: "en",
    mainEntityOfPage: { "@id": `${url}#webpage` },
    author: { "@id": ID.organization },
    publisher: { "@id": ID.organization },
    about: { "@id": ID.software },
    ...(section ? { articleSection: section } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(image ? { image: absolute(image) } : {}),
  };
}

/**
 * A comparison page's subject. Naming the competitor as a real
 * `SoftwareApplication` — rather than as loose prose — is what lets an engine
 * connect "alternative to Obsidian" to this page instead of guessing.
 */
export function comparedApplication({
  name,
  url,
  description,
  category = "ProductivityApplication",
}: {
  name: string;
  url?: string;
  description: string;
  category?: string;
}): Thing {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#compared-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    applicationCategory: category,
    description,
    ...(url ? { url } : {}),
  };
}

/** An ordered list of pages — the alternatives hub and the glossary index. */
export function itemList({
  path,
  name,
  description,
  items,
}: {
  path: string;
  name: string;
  description: string;
  items: { name: string; path: string; description?: string }[];
}): Thing {
  return {
    "@type": "ItemList",
    "@id": `${absolute(path)}#list`,
    name,
    description,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: absolute(item.path),
      ...(item.description ? { description: item.description } : {}),
    })),
  };
}

/** A defined term in the glossary — the vocabulary an AI engine indexes on. */
export function definedTerm({
  path,
  term,
  definition,
  alternateNames,
}: {
  path: string;
  term: string;
  definition: string;
  alternateNames?: readonly string[];
}): Thing {
  return {
    "@type": "DefinedTerm",
    "@id": `${absolute(path)}#term`,
    name: term,
    description: definition,
    url: absolute(path),
    ...(alternateNames?.length ? { alternateName: [...alternateNames] } : {}),
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      "@id": `${SITE_URL}/glossary#set`,
      name: "Nodum knowledge-management glossary",
      url: `${SITE_URL}/glossary`,
    },
  };
}

/** Step-by-step instructions — "how to switch from X" earns a HowTo result. */
export function howTo({
  path,
  name,
  description,
  steps,
  totalTime,
}: {
  path: string;
  name: string;
  description: string;
  steps: { name: string; text: string }[];
  totalTime?: string;
}): Thing {
  return {
    "@type": "HowTo",
    "@id": `${absolute(path)}#howto`,
    name,
    description,
    ...(totalTime ? { totalTime } : {}),
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}
