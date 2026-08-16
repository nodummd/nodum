"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { DemoVault } from "@/components/marketing/demo-vault";
import { Knot } from "@/components/marketing/knot";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { useAuthStore } from "@/lib/stores/auth-store";

const GITHUB = "https://github.com/nodummd/nodum";

/** The five marks you actually type. The syntax *is* the product, so it gets
 *  to speak for itself rather than being described in prose. */
const SYNTAX = [
  { mark: "[[Note]]", label: "link two ideas" },
  { mark: "[[Note|alias]]", label: "link, call it something else" },
  { mark: "#tag/nested", label: "group them" },
  { mark: "![[image.png]]", label: "drop a file in" },
  { mark: "> [!note]", label: "call it out" },
];

export default function LandingPage() {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/vault");
  }, [status, router]);

  return (
    <>
      <SiteNav />

      <main>
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-5 pt-14 pb-20 text-center sm:px-8 sm:pt-20">
          <div className="mx-auto max-w-3xl">
            <Knot
              className="mk-in-scale mx-auto w-[min(72vw,23rem)]"
              priority
              tilt
              alt="The Nodum knot: three strands looped through each other"
            />

            <p className="mk-eyebrow mk-in mt-9" style={{ animationDelay: "120ms" }}>
              nodum · Latin for knot
            </p>

            <h1
              className="mk-display mk-in mt-4 text-[clamp(2.7rem,8vw,4.75rem)]"
              style={{ animationDelay: "200ms" }}
            >
              Notes are the <span className="mk-strand-text">knots</span>.
            </h1>

            <p
              className="mk-in mx-auto mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[var(--mk-muted)]"
              style={{ animationDelay: "280ms" }}
            >
              The value is the rope between them. Nodum is an open-source knowledge base for
              the browser — markdown notes,{" "}
              <span className="mk-wikilink">
                <span className="mk-bracket">[[</span>wikilinks<span className="mk-bracket">]]</span>
              </span>
              , backlinks and a GPU-rendered graph of everything you know.
            </p>

            <div
              className="mk-in mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={{ animationDelay: "360ms" }}
            >
              <Link href="/signup" className="mk-btn mk-btn--primary w-full sm:w-auto">
                Start your vault
              </Link>
              <a
                href={GITHUB}
                target="_blank"
                rel="noreferrer"
                className="mk-btn mk-btn--ghost w-full sm:w-auto"
              >
                Read the source
              </a>
            </div>

            <p
              className="mk-mono mk-in mt-7 text-[0.7rem] tracking-wide text-[var(--mk-faint)]"
              style={{ animationDelay: "440ms" }}
            >
              MIT licensed · import an Obsidian vault · self-host in one command
            </p>
          </div>
        </section>

        {/* ── The syntax you already know ──────────────────── */}
        <section className="border-y border-[var(--mk-line)] bg-[var(--mk-ink-raised)]">
          <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
            <ul className="flex flex-wrap items-start justify-center gap-x-10 gap-y-6">
              {SYNTAX.map((s, i) => (
                <Reveal as="li" key={s.mark} delay={i * 60} className="text-center">
                  <p className="mk-mono text-[0.9375rem] text-[var(--mk-violet)]">{s.mark}</p>
                  <p className="mt-1.5 text-[0.75rem] text-[var(--mk-faint)]">{s.label}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ── A working vault, not a screenshot ────────────── */}
        <section id="workspace" className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-28">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="mk-eyebrow">Have a go</p>
            <h2 className="mk-display mt-4 text-[clamp(1.9rem,4vw,3rem)]">
              This one is real. Try it.
            </h2>
            <p className="mt-5 leading-relaxed text-[var(--mk-muted)]">
              The same GPU graph the app runs on, with a small vault loaded. Drag a node,
              hover a file — and give a folder a colour to watch its notes change in the
              graph.
            </p>
          </Reveal>

          <Reveal delay={120} className="relative mt-14">
            {/* the strand, pooled under the frame */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 -bottom-6 top-10 -z-10 rounded-full opacity-45 blur-[90px]"
              style={{
                background:
                  "linear-gradient(100deg, var(--mk-azure), var(--mk-indigo) 45%, var(--mk-magenta))",
              }}
            />
            <DemoVault
              fallbackSrc="/workspace.jpg"
              fallbackAlt="The Nodum workspace: a colour-coded folder tree on the left, the knowledge graph filling the main pane, each note drawn in its folder's colour"
            />
            <p className="mk-mono mt-4 text-center text-[0.7rem] text-[var(--mk-faint)]">
              @cosmos.gl/graph on WebGL2 · the engine your vault renders with
            </p>
          </Reveal>
        </section>

        {/* ── What you get ─────────────────────────────────── */}
        <section
          id="features"
          className="mx-auto max-w-6xl border-t border-[var(--mk-line)] px-5 py-24 sm:px-8 sm:py-28"
        >
          <Reveal className="max-w-2xl">
            <p className="mk-eyebrow">What it does</p>
            <h2 className="mk-display mt-4 text-[clamp(1.9rem,4vw,3rem)]">
              Write it once. Find it from everywhere.
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            <Reveal delay={0}>
              <Feature
                art={<BacklinkArt />}
                title="Links point both ways"
                body="Type a wikilink and the note on the other end grows a backlink, with the sentence around it. Link something you haven't written and it becomes a ghost on the graph — click it and the note exists."
              />
            </Reveal>
            <Reveal delay={90}>
              <Feature
                art={<GraphArt />}
                title="A graph that reads like a map"
                body="Your whole vault as a GPU force simulation, smooth at tens of thousands of notes. Colour a folder in the explorer and its notes carry that colour into the graph."
              />
            </Reveal>
            <Reveal delay={180}>
              <Feature
                art={<FileArt />}
                title="Plain markdown, always yours"
                body="Drop in an Obsidian vault as a zip and every link resolves across the batch. Ask for it back and you get a folder-true zip. Files stay files."
              />
            </Reveal>
          </div>
        </section>

        {/* ── Self-host ────────────────────────────────────── */}
        <section id="self-host" className="border-t border-[var(--mk-line)]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 md:grid-cols-2 md:py-28">
            <Reveal>
              <p className="mk-eyebrow">Run it yourself</p>
              <h2 className="mk-display mt-4 text-[clamp(1.9rem,4vw,3rem)]">
                Your vault, your server.
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-[var(--mk-muted)]">
                One compose file brings up the API, Postgres, Redis, MinIO and a Caddy edge
                with automatic TLS. Docker or Podman, dev through production.
              </p>
              <a
                href={GITHUB}
                target="_blank"
                rel="noreferrer"
                className="mk-btn mk-btn--ghost mt-8"
              >
                Read the deploy guide
              </a>
            </Reveal>

            <Reveal delay={120}>
              <div className="mk-card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--mk-line)] px-4 py-2.5">
                  <span className="size-2 rounded-full bg-[var(--mk-magenta)] opacity-70" />
                  <span className="size-2 rounded-full bg-[var(--mk-violet)] opacity-70" />
                  <span className="size-2 rounded-full bg-[var(--mk-azure)] opacity-70" />
                  <span className="mk-mono ml-2 text-[0.7rem] text-[var(--mk-faint)]">
                    nodum/deploy
                  </span>
                </div>
                <pre className="mk-mono overflow-x-auto px-5 py-5 text-[0.8125rem] leading-7 text-[var(--mk-muted)]">
                  <code>
                    <span className="text-[var(--mk-faint)]">$</span> git clone {GITHUB}
                    {"\n"}
                    <span className="text-[var(--mk-faint)]">$</span> cd nodum/deploy
                    {"\n"}
                    <span className="text-[var(--mk-faint)]">$</span>{" "}
                    <span className="text-[var(--mk-paper)]">./compose.sh prod up -d --build</span>
                    {"\n\n"}
                    <span className="text-[var(--mk-faint)]">
                      # api · postgres · redis · minio · caddy
                    </span>
                  </code>
                </pre>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────── */}
        <section className="border-t border-[var(--mk-line)] px-5 py-24 text-center sm:px-8">
          <Reveal className="mx-auto max-w-xl">
            <Knot className="mx-auto w-[min(38vw,9rem)]" />
            <h2 className="mk-display mt-8 text-[clamp(1.9rem,4.5vw,3rem)]">
              Start tying things together.
            </h2>
            <p className="mt-4 text-[var(--mk-muted)]">
              A vault takes about ten seconds to make. Bring notes with you, or start with one.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="mk-btn mk-btn--primary w-full sm:w-auto">
                Start your vault
              </Link>
              <Link href="/login" className="mk-btn mk-btn--ghost w-full sm:w-auto">
                I already have one
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function Feature({
  art,
  title,
  body,
}: {
  art: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="mk-card flex h-full flex-col p-6">
      <div className="mb-6">{art}</div>
      <h3 className="mk-display text-[1.25rem] tracking-[-0.02em]">{title}</h3>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--mk-muted)]">{body}</p>
    </article>
  );
}

/* ── Hairline vignettes. Each draws the actual mechanic it sits above,
      in the logo's own hues — not a stock icon. ─────────────────── */

/** Two notes: the link you type (solid, out) and the backlink you get for
 *  free (dashed, back). */
function BacklinkArt() {
  return (
    <svg viewBox="0 0 160 78" fill="none" className="h-[78px] w-full" aria-hidden>
      <rect x="1" y="14" width="56" height="50" rx="9" stroke="var(--mk-line-strong)" />
      <rect x="103" y="14" width="56" height="50" rx="9" stroke="var(--mk-line-strong)" />
      <path d="M11 28h26M11 36h18" stroke="var(--mk-violet)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11 46h32" stroke="var(--mk-violet)" strokeWidth="1.6" strokeLinecap="round" opacity=".35" />
      <path d="M113 28h26M113 36h18" stroke="var(--mk-azure)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M113 46h32" stroke="var(--mk-azure)" strokeWidth="1.6" strokeLinecap="round" opacity=".35" />

      {/* the link out */}
      <path d="M59 31h38" stroke="var(--mk-violet)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="m97 31-6-3.4v6.8L97 31Z" fill="var(--mk-violet)" />

      {/* the backlink home */}
      <path
        d="M101 47H63"
        stroke="var(--mk-magenta)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="4 4"
      />
      <path d="m63 47 6-3.4v6.8L63 47Z" fill="var(--mk-magenta)" />
    </svg>
  );
}

function GraphArt() {
  return (
    <svg viewBox="0 0 160 78" fill="none" className="h-[78px] w-full" aria-hidden>
      <g stroke="var(--mk-line-strong)" strokeWidth="1">
        <path d="M40 26 78 39M78 39l36-18M78 39l30 26M78 39 34 56M114 21l-6 44M40 26 34 56" />
      </g>
      <circle cx="78" cy="39" r="7" fill="var(--mk-violet)" />
      <circle cx="40" cy="26" r="4.5" fill="var(--mk-azure)" />
      <circle cx="34" cy="56" r="4" fill="var(--mk-azure)" />
      <circle cx="114" cy="21" r="5" fill="var(--mk-magenta)" />
      <circle cx="108" cy="65" r="4" fill="var(--mk-magenta)" />
      <circle cx="140" cy="45" r="3" stroke="var(--mk-line-strong)" />
    </svg>
  );
}

function FileArt() {
  return (
    <svg viewBox="0 0 160 78" fill="none" className="h-[78px] w-full" aria-hidden>
      <path
        d="M52 6h34l22 21v45a6 6 0 0 1-6 6H52a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6Z"
        stroke="var(--mk-line-strong)"
      />
      <path d="M86 6v21h22" stroke="var(--mk-line-strong)" />
      <path d="M58 40h18" stroke="var(--mk-magenta)" strokeWidth="2" strokeLinecap="round" />
      <path d="M58 50h38M58 58h30" stroke="var(--mk-violet)" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <path d="M82 40h14" stroke="var(--mk-azure)" strokeWidth="2" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}
