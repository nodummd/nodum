import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

/**
 * Chrome for the editorial pages — /alternatives, the topic pages, /glossary
 * and /faq. A route group, so it adds a layout without adding a URL segment:
 * these pages sit at the top level of the site, which is where the queries
 * they answer expect to find them.
 *
 * No `"use client"` anywhere below this point. Every one of these pages must
 * be fully present in the initial HTML, because half the audience for them is
 * a crawler that will not run JavaScript.
 */
export default function SeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
