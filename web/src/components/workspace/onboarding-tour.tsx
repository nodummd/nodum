"use client";

/**
 * First-run tour of the workspace.
 *
 * A spotlight cut out of a dim veil, over the REAL interface — the explorer,
 * the editor, the ribbon buttons — with a small card beside each. Nothing is
 * mocked or screenshotted: the person is looking at their own workspace with
 * one part of it lit.
 *
 * Skippable and closable at every step. Skip and × do not simply vanish: they
 * jump to the one question that must be asked once — the Demo Workspace — so
 * a person is never left with a second prompt after dismissing the first.
 * Finishing, by any route, marks `onboardingDone` on the account. Re-runnable
 * from Help and Settings → General.
 */

import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DemoWorkspaceCard, useRememberFirstRun } from "./demo-workspace-offer";
import { Button } from "@/components/ui/button";
import { DOCS_URL } from "@/lib/app-meta";
import { useUserPrefs } from "@/lib/hooks/use-editor-settings";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

type Side = "right" | "left" | "bottom" | "center";

interface Step {
  id: string;
  /** `data-tour` name of the element to light. Omit for a centred card. */
  target?: string;
  side: Side;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}

const KBD = "rounded border border-ob-border bg-ob-bg px-1 py-px font-mono text-[11px] text-ob-text";

const STEPS: Step[] = [
  {
    id: "welcome",
    side: "center",
    eyebrow: "Welcome",
    title: "Your notes, linked",
    body: (
      <>
        Nodum keeps notes as plain markdown. Write <span className={KBD}>[[</span> to link one note to
        another, and the links become a graph you can walk. This is a one-minute look around — you can
        leave at any point.
      </>
    ),
  },
  {
    id: "explorer",
    target: "explorer",
    side: "right",
    eyebrow: "Files",
    title: "Folders and notes live here",
    body: (
      <>
        Click a note to open it. Right-click a folder or note for colours, moving, renaming and
        more — a folder&apos;s colour flows down to its notes and into the graph. The name at the top
        is the vault switcher: each vault is a separate workspace.
      </>
    ),
  },
  {
    id: "editor",
    target: "editor",
    side: "center",
    eyebrow: "Writing",
    title: "Write here",
    body: (
      <>
        Type <span className={KBD}>[[</span> and a name to link a note; the link becomes clickable
        and the other note gains a backlink. Three views along the top-right of a note: live preview,
        source, reading. Right-click selected text for formatting, colours and links.
      </>
    ),
  },
  {
    id: "graph",
    target: "graph",
    side: "right",
    eyebrow: "The graph",
    title: "Every note is a node",
    body: (
      <>
        <span className={KBD}>⌘G</span> opens the graph. Notes are dots, links are lines, folder
        colours and tag groups colour them. Hover a file or a link anywhere in the app and its node
        breathes here.
      </>
    ),
  },
  {
    id: "find",
    target: "switcher",
    side: "right",
    eyebrow: "Finding things",
    title: "Two shortcuts to remember",
    body: (
      <>
        <span className={KBD}>⌘O</span> opens any note by name; <span className={KBD}>⌘P</span> runs
        any command. Full-text search lives in the left sidebar&apos;s second tab.
      </>
    ),
  },
  {
    id: "panels",
    target: "panels",
    side: "left",
    eyebrow: "Panels",
    title: "What connects to this note",
    body: (
      <>
        Backlinks, outgoing links, tags, an outline and a local graph for the note you are reading —
        and an AI chat that can search, write and link notes for you, using your own provider key.
      </>
    ),
  },
  {
    id: "demo",
    side: "center",
    eyebrow: "One question",
    title: "Want a Demo Workspace?",
    body: null, // the demo card supplies its own body
  },
  {
    id: "done",
    side: "center",
    eyebrow: "That's it",
    title: "You're set",
    body: (
      <>
        Settings are <span className={KBD}>⌘,</span>. Help lives behind the{" "}
        <span className={KBD}>?</span> in the ribbon — this tour, the shortcuts, and the{" "}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ob-accent underline underline-offset-2"
        >
          documentation
        </a>
        , which explains every button with a picture.
      </>
    ),
  },
];

const DEMO_INDEX = STEPS.findIndex((s) => s.id === "demo");
/** ⌘/Ctrl chords the workspace binds (workspace.tsx) — the only ones the tour eats. */
const APP_CHORDS = new Set(["o", "n", "g", "p", "w", ",", "e", "\\", "[", "]", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const PAD = 8; // spotlight breathing room around the target
const GAP = 14; // card distance from the spotlight
const CARD_W = 340;
const CARD_W_CENTER = 400; // the centred cards have room, and the demo card wants it

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function measure(target: string | undefined): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Where the card goes for a given spotlight, clamped into the viewport. */
function place(
  rect: Rect | null,
  side: Side,
  cardW: number,
  cardH: number,
  vw: number,
  vh: number,
): { left: number; top: number } {
  const clamp = (left: number, top: number) => ({
    left: Math.max(12, Math.min(left, vw - cardW - 12)),
    top: Math.max(12, Math.min(top, vh - cardH - 12)),
  });
  if (!rect || side === "center") {
    return clamp((vw - cardW) / 2, (vh - cardH) / 2);
  }
  // Beside a tall region the card hangs near its top; beside a small control
  // (a ribbon button) it centres on it, so the ring and the card read as one.
  const top = rect.h > 120 ? rect.y + 24 : rect.y + rect.h / 2 - 48;
  if (side === "right") return clamp(rect.x + rect.w + PAD + GAP, top);
  if (side === "left") return clamp(rect.x - PAD - GAP - cardW, top);
  return clamp(rect.x + rect.w / 2 - cardW / 2, rect.y + rect.h + PAD + GAP);
}

export function OnboardingTour() {
  const user = useAuthStore((s) => s.user);
  const { onboardingDone } = useUserPrefs();
  const isMobile = useIsMobile();
  const tourOpen = useWorkspaceStore((s) => s.tourOpen);
  const setTourOpen = useWorkspaceStore((s) => s.setTourOpen);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);

  // First run opens it on its own; Help re-opens it. On mobile the drawers
  // hide everything a spotlight would point at, so first run stays quiet.
  // Never on top of Settings: two modals would fight over pointer events.
  const open = Boolean(user) && !settingsOpen && (tourOpen || (!onboardingDone && !isMobile));

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight },
  );
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];

  // Optimistic, so the veil is gone on the click and never flashes back.
  // `mutate` is stable across renders (the mutation object is not), which
  // keeps the callbacks below — and the effects that depend on them — still.
  const { mutate: finish } = useRememberFirstRun({ onboardingDone: true });
  // Dismissing the demo step (× / Esc on it) is the answer "not now": both
  // flags in one write, so no dialog re-asks the question the moment the
  // veil lifts.
  const { mutate: finishDeclined } = useRememberFirstRun({ onboardingDone: true, demoOffered: true });

  const close = useCallback(() => {
    setTourOpen(false);
    if (!useAuthStore.getState().user?.settings?.onboardingDone) finish();
    setIndex(0);
  }, [finish, setTourOpen]);

  /** Skip / × / Esc: not straight out — to the one question asked once. A
   *  person who has already answered it (re-running the tour) leaves directly;
   *  dismissing the question itself counts as declining it. */
  const leave = useCallback(() => {
    const offered = useAuthStore.getState().user?.settings?.demoOffered === true;
    if (!offered && index === DEMO_INDEX) {
      setTourOpen(false);
      finishDeclined();
      setIndex(0);
      return;
    }
    if (offered || index >= DEMO_INDEX) close();
    else setIndex(DEMO_INDEX);
  }, [close, finishDeclined, index, setTourOpen]);

  // The tour talks about the explorer, the ribbon and the right panel — make
  // sure they are on screen while it runs, and put them back afterwards.
  useEffect(() => {
    if (!open) return;
    const s = useWorkspaceStore.getState();
    const prev = {
      leftSidebarOpen: s.leftSidebarOpen,
      rightSidebarOpen: s.rightSidebarOpen,
      ribbonVisible: s.ribbonVisible,
    };
    useWorkspaceStore.setState({ leftSidebarOpen: true, rightSidebarOpen: true, ribbonVisible: true });
    return () => {
      useWorkspaceStore.setState(prev);
    };
  }, [open]);

  // Modal for real: everything outside the tour is inert while it is open, so
  // Tab, Shift+Tab and screen readers stay in the card.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const touched: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement) || el === root || el.contains(root) || el.inert) continue;
      el.inert = true;
      touched.push(el);
    }
    return () => {
      for (const el of touched) el.inert = false;
    };
  }, [open]);

  // Track the spotlight target through resizes and layout shifts. The rect
  // is measured in a layout effect so the first paint already has it, and
  // re-measured on resize plus a short poll — sidebars animate open, panes
  // resize, and neither fires an event the veil can subscribe to.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      setRect((prev) => {
        const next = measure(step.target);
        if (prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h)
          return prev; // unchanged → no re-render on this tick
        return next;
      });
      const w = window.innerWidth;
      const h = window.innerHeight;
      setVp((p) => (p.w === w && p.h === h ? p : { w, h }));
      if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    };
    update();
    window.addEventListener("resize", update);
    const poll = window.setInterval(update, 400);
    return () => {
      window.removeEventListener("resize", update);
      window.clearInterval(poll);
    };
  }, [open, step.target, index]);

  // Focus lands on the card when the tour opens and on every step — once,
  // not on every re-render, so Tab can reach the buttons. A menu or dialog
  // that opened the tour returns focus to its trigger a tick later; the
  // second, deferred focus wins that race.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const t = window.setTimeout(() => cardRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, index]);

  // Keyboard, in the capture phase so it runs before the workspace's own
  // hotkeys and before any dialog's Escape: the workspace's own chords (⌘O,
  // ⌘P, ⌘,, ⌘N …) are swallowed while the tour is up — they would open UI
  // under the veil — while browser chords (⌘R, ⌘L, ⌘C, ⌘+/-) pass through.
  // Esc leaves, arrows move, Tab cycles inside the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (APP_CHORDS.has(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        leave();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusables = Array.from(
          cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !cardRef.current.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (active === first || active === cardRef.current)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }
      const inCard = cardRef.current?.contains(document.activeElement) ?? false;
      if (!inCard) return;
      if (e.key === "ArrowRight" && step.id !== "demo" && index < STEPS.length - 1) {
        setIndex((i) => i + 1);
      } else if (e.key === "ArrowLeft" && index > 0) {
        setIndex((i) => i - 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, index, step.id, leave]);

  // Never wider than the viewport: on a phone the 400px card would push its
  // × and Next off the right edge.
  const cardW = Math.min(step.side === "center" ? CARD_W_CENTER : CARD_W, Math.max(vp.w - 24, 240));
  const pos = useMemo(
    () => place(rect, step.side, cardW, cardH, vp.w, vp.h),
    [rect, step.side, cardW, cardH, vp.w, vp.h],
  );

  if (!open || typeof document === "undefined") return null;

  const spot = rect
    ? { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 }
    : null;
  const isLast = index === STEPS.length - 1;
  const total = STEPS.length;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour"
      data-testid="tour"
    >
      {/* The veil, with the spotlight cut out. evenodd: outer rect minus the
          rounded inner rect. It swallows clicks — the tour is modal — except
          over the hole, which is left as an accent ring so the lit UI reads as
          the subject, not as something disabled. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <path
          fill="rgba(0,0,0,0.62)"
          fillRule="evenodd"
          d={
            `M0 0H${vp.w}V${vp.h}H0Z` +
            (spot
              ? ` M${spot.x + 8} ${spot.y}H${spot.x + spot.w - 8}a8 8 0 0 1 8 8V${spot.y + spot.h - 8}a8 8 0 0 1-8 8H${spot.x + 8}a8 8 0 0 1-8-8V${spot.y + 8}a8 8 0 0 1 8-8Z`
              : "")
          }
        />
        {spot && (
          <rect
            x={spot.x}
            y={spot.y}
            width={spot.w}
            height={spot.h}
            rx={8}
            fill="none"
            stroke="var(--ob-interactive-accent)"
            strokeWidth={1.5}
            className="tour-ring"
          />
        )}
      </svg>

      <div
        ref={cardRef}
        tabIndex={-1}
        data-testid="tour-card"
        data-step={step.id}
        className="absolute rounded-lg border border-ob-border bg-ob-sidebar p-4 text-ob-text shadow-2xl outline-none ring-1 ring-black/40"
        style={{ left: pos.left, top: pos.top, width: cardW }}
      >
        <div className="mb-2 flex items-start gap-2">
          <p className="text-[11px] font-medium tracking-wide text-ob-accent uppercase">
            {step.eyebrow}
            <span className="ml-2 text-ob-faint normal-case tracking-normal">
              {index + 1} / {total}
            </span>
          </p>
          <button
            type="button"
            aria-label="Close tour"
            onClick={leave}
            className="ml-auto -mt-1 -mr-1 flex size-6 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        <h2 className="mb-1.5 text-[15px] font-semibold leading-snug">{step.title}</h2>

        {step.id === "demo" ? (
          <DemoWorkspaceCard
            compact
            // Creating the demo navigates away, which ends the tour: mark it
            // done in the same write as the answer, then just close.
            alsoRemember={{ onboardingDone: true }}
            onCreated={() => {
              setTourOpen(false);
              setIndex(0);
            }}
            onDecline={() => setIndex((i) => i + 1)}
          />
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-ob-muted">{step.body}</p>
            <div className="mt-4 flex items-center gap-1.5">
              {index > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setIndex((i) => i - 1)}>
                  <ArrowLeft className="mr-1 size-3.5" strokeWidth={2} />
                  Back
                </Button>
              )}
              <div className="flex-1" />
              {!isLast && (
                <Button size="sm" variant="ghost" onClick={leave}>
                  Skip
                </Button>
              )}
              {isLast ? (
                <Button size="sm" onClick={close}>
                  Finish
                </Button>
              ) : (
                <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                  {index === 0 ? "Start" : "Next"}
                  <ArrowRight className="ml-1 size-3.5" strokeWidth={2} />
                </Button>
              )}
            </div>
          </>
        )}
        <div className={cn("mt-3 flex gap-1", step.id === "demo" && "mt-4")} aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= index ? "bg-ob-accent" : "bg-ob-border",
              )}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
