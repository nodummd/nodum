import Link from "next/link";

import { Knot, Wordmark } from "@/components/marketing/knot";

/** Two-up auth layout: the brand holds the left, the form holds the right.
 *  Below `lg` the panel drops away and the knot moves above the form, so the
 *  logo is the first thing you see on a phone too. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden border-r border-[var(--mk-line)] bg-[var(--mk-ink-raised)] lg:block lg:p-12">
        {/* One measure for the whole panel. The wordmark, the knot and the
            footnotes share a left edge and a width — pin the wordmark to the
            panel padding while the knot centres itself and the three land on
            three different edges, which is what made the mark look adrift. */}
        <div className="relative z-10 mx-auto flex h-full w-full max-w-[27rem] flex-col justify-between">
          <Link href="/" aria-label="Nodum home" className="w-fit">
            <Wordmark />
          </Link>

          <div>
            <Knot className="mk-in-scale w-full" priority alt="" />
            <h2 className="mk-display mt-10 text-[clamp(1.9rem,2.6vw,2.75rem)]">
              Notes are the <span className="mk-strand-text">knots</span>.
            </h2>
            <p className="mt-4 leading-relaxed text-[var(--mk-muted)]">
              The value is the rope between them.
            </p>
          </div>

          <ul className="mk-mono space-y-2 text-[0.75rem] text-[var(--mk-faint)]">
            <li>markdown that stays markdown</li>
            <li>backlinks that point both ways</li>
            <li>a graph of everything you know</li>
          </ul>
        </div>
      </aside>

      {/* Form side */}
      <main className="flex items-center justify-center px-5 py-14 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-10 flex flex-col items-center gap-6 lg:hidden">
            <Link href="/" aria-label="Nodum home">
              <Knot className="mk-in-scale w-[min(42vw,9rem)]" priority alt="" />
            </Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
