import type { Metadata } from "next";

import { OG_IMAGE, SITE_NAME, SITE_URL, absolute } from "./site";

/**
 * The single way a page declares its metadata.
 *
 * Every public route calls this rather than hand-rolling a Metadata object, so
 * three things can never be forgotten: a canonical URL (duplicate-content
 * insurance the moment a page picks up a `?ref=` parameter), a self-describing
 * Open Graph card, and the `max-image-preview:large` / `max-snippet:-1` robots
 * directives that let Google and the AI engines quote a whole passage instead
 * of the 160-character stub they default to.
 */
export interface PageSeo {
  /**
   * Page title *without* the site suffix — the root template appends
   * " · Nodum". So do not put the brand in here: "Nodum FAQ" becomes
   * "Nodum FAQ · Nodum", which wastes the ~60 characters a result actually
   * shows and reads like a bug to anyone who notices it.
   */
  title: string;
  /**
   * Skip the template. Only the front page should: its title already names
   * the brand first, which is what a branded search result wants to see.
   */
  absoluteTitle?: boolean;
  /** ~150–160 characters, and a complete sentence: it is also the AI answer. */
  description: string;
  /** Site-relative path, leading slash, no trailing slash (`/alternatives`). */
  path: string;
  keywords?: readonly string[];
  /** Site-relative or absolute. Defaults to the shared 1200×630 card. */
  image?: string;
  imageAlt?: string;
  /** `article` adds published/modified times to the Open Graph card. */
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  /** Capability-URL and app pages: keep them out of the index. */
  noindex?: boolean;
}

export function pageMetadata({
  title,
  absoluteTitle = false,
  description,
  path,
  keywords,
  image = OG_IMAGE,
  imageAlt,
  type = "website",
  publishedTime,
  modifiedTime,
  noindex = false,
}: PageSeo): Metadata {
  const url = absolute(path);
  const images = [{ url: image, width: 1200, height: 630, alt: imageAlt ?? title }];

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(keywords?.length ? { keywords: [...keywords] } : {}),
    alternates: { canonical: url },
    robots: noindex
      ? // `follow` still counts: an unindexed page should keep passing its
        // links on to the pages that *are* meant to rank.
        { index: false, follow: true, googleBot: { index: false, follow: true } }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      type,
      url,
      siteName: SITE_NAME,
      title,
      description,
      locale: "en_US",
      images,
      ...(type === "article" ? { publishedTime, modifiedTime } : {}),
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/**
 * `metadataBase` needs an absolute URL and `SITE_URL` is already normalised;
 * exported here so the root layout does not re-parse it.
 */
export const METADATA_BASE = new URL(SITE_URL);
