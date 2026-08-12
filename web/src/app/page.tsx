"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/stores/auth-store";

const FEATURES = [
  {
    title: "Linked thinking",
    body: "Write in markdown, connect ideas with [[wikilinks]], and watch backlinks surface connections you forgot you made.",
  },
  {
    title: "A living graph",
    body: "Your vault as an interactive, GPU-rendered force graph — smooth at tens of thousands of notes.",
  },
  {
    title: "Your notes, forever",
    body: "Plain markdown in, plain markdown out. Import an Obsidian vault, export a zip anytime. Fully open source.",
  },
];

export default function LandingPage() {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/vault");
  }, [status, router]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <GraphMark className="size-6 text-primary" />
          nodum
        </div>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Sign up</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-24 pb-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-balance">
          Notes that <span className="text-primary">link back</span>.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground text-balance">
          Nodum is an open-source knowledge base for the web — markdown notes, wikilinks,
          backlinks, and an interactive knowledge graph. Like Obsidian, but in your browser.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/signup">Start your vault</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="https://github.com/vorreix/nodum" target="_blank" rel="noreferrer">
              View source
            </a>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border bg-card p-6">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        MIT licensed · <a className="underline" href="https://github.com/vorreix/nodum">github.com/vorreix/nodum</a>
      </footer>
    </main>
  );
}

function GraphMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="6" cy="6" r="3" fill="currentColor" />
      <circle cx="18" cy="8" r="2.2" fill="currentColor" opacity="0.7" />
      <circle cx="10" cy="18" r="2.6" fill="currentColor" opacity="0.85" />
      <path d="M8 7.5 15.9 8M7.2 8.6 9.3 15.6M16.3 9.9 11.8 16.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
