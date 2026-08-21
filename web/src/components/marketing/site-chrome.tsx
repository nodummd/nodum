import Link from "next/link";

import { Wordmark } from "./knot";

const GITHUB = "https://github.com/nodummd/nodum";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--mk-line)] bg-[color-mix(in_oklab,var(--mk-ink)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Nodum home">
          <Wordmark />
        </Link>

        {/* Site-wide links, not page anchors: the nav is on every page in the
            marketing surface now, so an in-page "#features" would be a dead
            link from /alternatives. It is also the strongest internal-link
            signal the site has — every page pointing at the hubs. */}
        <nav className="hidden items-center gap-7 md:flex">
          <Link className="mk-navlink" href="/#workspace">
            Try it
          </Link>
          <Link className="mk-navlink" href="/alternatives">
            Compare
          </Link>
          <Link className="mk-navlink" href="/learn">
            Learn
          </Link>
          <Link className="mk-navlink" href="/community">
            Community
          </Link>
          <Link className="mk-navlink" href="/docs">
            Docs
          </Link>
          <Link className="mk-navlink" href="/faq">
            FAQ
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            aria-label="Nodum on GitHub"
            title="Nodum on GitHub"
            className="mk-navlink flex size-9 items-center justify-center p-0"
          >
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
          <Link href="/login" className="mk-navlink px-2 py-1">
            Log in
          </Link>
          <Link href="/signup" className="mk-btn mk-btn--primary h-9 px-4 text-[0.875rem]">
            Start your vault
          </Link>
        </div>
      </div>
    </header>
  );
}

/** The comparisons worth a sitewide link. The rest are one hop away on /alternatives. */
const FOOTER_COMPARISONS = [
  { label: "vs Obsidian", href: "/alternatives/obsidian" },
  { label: "vs Notion", href: "/alternatives/notion" },
  { label: "vs Logseq", href: "/alternatives/logseq" },
  { label: "vs Evernote", href: "/alternatives/evernote" },
  { label: "vs Roam Research", href: "/alternatives/roam-research" },
  { label: "All comparisons", href: "/alternatives" },
];

const FOOTER_TOPICS = [
  { label: "Second brain", href: "/learn/second-brain" },
  { label: "AI note-taking", href: "/learn/ai-note-taking" },
  { label: "Open-source notes", href: "/learn/open-source-note-taking" },
  { label: "Knowledge graphs", href: "/learn/knowledge-graph" },
  { label: "Self-hosting", href: "/learn/self-hosted-notes" },
  { label: "Zettelkasten", href: "/learn/zettelkasten" },
];

const FOOTER_SITE = [
  { label: "Documentation", href: "/docs" },
  { label: "Glossary", href: "/glossary" },
  { label: "FAQ", href: "/faq" },
  { label: "Choosing a notes app", href: "/learn/note-taking-app" },
  { label: "Log in", href: "/login" },
  { label: "Start your vault", href: "/signup" },
];

/**
 * A real footer rather than a link strip. Every page on the site is at most
 * two clicks from every other, which is what stops the editorial pages
 * becoming orphans — and an orphaned page is one a crawler reaches late,
 * values low, and refreshes rarely.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--mk-line)]">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div className="flex flex-col items-start gap-2">
            <Wordmark />
            <p className="mk-mono text-[0.72rem] text-[var(--mk-faint)]">Latin for knot, node.</p>
            <p className="mt-2 max-w-[22rem] text-[0.82rem] leading-relaxed text-[var(--mk-muted)]">
              An open-source knowledge base for the browser. Markdown notes, wikilinks, backlinks
              and a living graph.
            </p>
            <a
              className="mk-navlink mt-2"
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
            >
              Read the source
            </a>
          </div>

          <FooterColumn title="Compare" links={FOOTER_COMPARISONS} />
          <FooterColumn title="Learn" links={FOOTER_TOPICS} />
          <FooterColumn title="Site" links={FOOTER_SITE} />
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--mk-line)] pt-6 sm:flex-row">
          <span className="mk-mono text-[0.72rem] text-[var(--mk-faint)]">
            MIT licensed · self-host in one command
          </span>
          <span className="mk-mono text-[0.72rem] text-[var(--mk-faint)]">
            Notes are the knots.
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <nav aria-label={title}>
      <p className="mk-eyebrow">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link className="mk-navlink text-[0.86rem]" href={link.href}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
