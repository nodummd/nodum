import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "./providers";

import { PRIMARY } from "@/lib/seo/keywords";
import { METADATA_BASE } from "@/lib/seo/metadata";
import { OG_IMAGE, SITE_META_DESCRIPTION, SITE_NAME, absolute } from "@/lib/seo/site";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/**
 * Site-wide defaults. Every field here is inherited by pages that do not
 * override it, which is why one thing is conspicuously absent: `alternates`.
 *
 * A canonical URL set on the root layout is inherited by every page that does
 * not set its own, which quietly points the whole site at "/" and collapses it
 * into one URL in the index. Canonicals belong on pages, and `pageMetadata()`
 * makes one impossible to forget.
 */
export const metadata: Metadata = {
  metadataBase: METADATA_BASE,
  title: {
    default: "Nodum — the open-source Obsidian alternative for your browser",
    template: "%s · Nodum",
  },
  description: SITE_META_DESCRIPTION,
  keywords: PRIMARY,
  applicationName: SITE_NAME,
  category: "productivity",
  authors: [{ name: "Nodum", url: "https://github.com/nodummd" }],
  creator: "Nodum",
  publisher: "Nodum",
  // Phone-number autodetection rewrites note content on iOS. It has no place
  // in a text editor.
  formatDetection: { telephone: false, address: false, email: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Let search and answer engines quote a whole passage and show a large
      // image. The defaults truncate both, and a truncated snippet is a
      // citation that says less about the product than a competitor's does.
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: "Nodum — notes are the knots",
    description:
      "An open-source knowledge base for the browser: markdown notes, wikilinks, backlinks and a living graph.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Nodum — notes are the knots" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nodum — notes are the knots",
    description:
      "An open-source knowledge base for the browser: markdown notes, wikilinks, backlinks and a living graph.",
    images: [OG_IMAGE],
  },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  // Set these in the environment when the properties are claimed; an empty
  // string is dropped rather than emitted as a broken tag.
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } }
      : {}),
  },
};

export const viewport: Viewport = {
  themeColor: "#06060b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/*
          Discovery hints for agents, hoisted into <head> by React. `describedby`
          is the llms.txt specification's own signal for "the curated index that
          applies to this URL"; the markdown alternate points at the same content
          this page renders, without the chrome.
        */}
        <link rel="describedby" type="text/markdown" href={absolute("/llms.txt")} />
        <link
          rel="alternate"
          type="text/markdown"
          href={absolute("/llms-full.txt")}
          title="All site content as markdown"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
