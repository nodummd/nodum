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

        <nav className="hidden items-center gap-8 md:flex">
          <a className="mk-navlink" href="#workspace">
            Try it
          </a>
          <a className="mk-navlink" href="#features">
            What it does
          </a>
          <a className="mk-navlink" href="#self-host">
            Self-host
          </a>
          <a className="mk-navlink" href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
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

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--mk-line)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-12 sm:px-8 md:flex-row md:justify-between">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <Wordmark />
          <p className="mk-mono text-[0.72rem] text-[var(--mk-faint)]">
            Latin for knot, node.
          </p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
          <a className="mk-navlink" href={GITHUB} target="_blank" rel="noreferrer">
            Source
          </a>
          <a className="mk-navlink" href={`${GITHUB}#quick-start`} target="_blank" rel="noreferrer">
            Docs
          </a>
          <Link className="mk-navlink" href="/login">
            Log in
          </Link>
          <Link className="mk-navlink" href="/signup">
            Start your vault
          </Link>
          <span className="mk-mono text-[0.72rem] text-[var(--mk-faint)]">MIT licensed</span>
        </nav>
      </div>
    </footer>
  );
}
