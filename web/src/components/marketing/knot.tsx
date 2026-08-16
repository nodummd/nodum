"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The logo, at the size it deserves. AVIF for the crisp 1000px render,
 * with the 512px PNG as the fallback for browsers without it.
 *
 * `tilt` adds a few degrees of pointer parallax — enough for a flat render
 * to read as an object in the room, not a sticker on the page.
 */
export function Knot({
  className,
  priority = false,
  tilt = false,
  alt = "",
}: {
  className?: string;
  priority?: boolean;
  tilt?: boolean;
  alt?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tilt) return;
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Coarse pointers have no hover to parallax with, and the listener would
    // just cost battery on scroll.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--mk-ry", `${(x * 14).toFixed(2)}deg`);
        el.style.setProperty("--mk-rx", `${(-y * 10).toFixed(2)}deg`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [tilt]);

  return (
    <div ref={ref} className={cn("mk-knot", tilt && "mk-knot-tilt", className)}>
      <picture>
        <source srcSet="/knot.avif" type="image/avif" />
        <img
          src="/logo.png"
          alt={alt}
          width={1000}
          height={1000}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
      </picture>
    </div>
  );
}

/** The wordmark: the knot at favicon size, locked up with the name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <picture>
        <source srcSet="/knot.avif" type="image/avif" />
        <img src="/logo.png" alt="" width={28} height={28} className="size-7" />
      </picture>
      <span
        className="mk-display text-[1.375rem] leading-none"
        style={{ letterSpacing: "-0.045em" }}
      >
        nodum
      </span>
    </span>
  );
}
