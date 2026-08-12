"use client";

/** Minimal toast store — errors and notices surfaced bottom-right (Obsidian style). */

import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = "error") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for react-query onError handlers. */
export function toastError(err: unknown, fallback: string): void {
  const message = err instanceof Error && err.message ? err.message : fallback;
  useToastStore.getState().push(message, "error");
}
