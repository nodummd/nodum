import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "./providers";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Where the shared card's image URL resolves from. Set
 *  NEXT_PUBLIC_SITE_URL when self-hosting on another domain. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nodum.md";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Nodum — linked notes, living graph", template: "%s · Nodum" },
  description:
    "Open-source web knowledge base: markdown notes with wikilinks, backlinks, and an interactive knowledge graph.",
  openGraph: {
    type: "website",
    siteName: "Nodum",
    title: "Nodum — notes are the knots",
    description:
      "An open-source knowledge base for the browser: markdown notes, wikilinks, backlinks and a living graph.",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Nodum — notes are the knots" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nodum — notes are the knots",
    description:
      "An open-source knowledge base for the browser: markdown notes, wikilinks, backlinks and a living graph.",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
