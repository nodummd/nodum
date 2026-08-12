"use client";

/** Toast surface — bottom-left notices, above the status bar. */

import { X } from "lucide-react";

import { useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-lg",
            t.kind === "error"
              ? "border-[#e93147]/40 bg-[#2a1a1c] text-[#ff8a95]"
              : "border-ob-border bg-ob-sidebar text-ob-text",
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
