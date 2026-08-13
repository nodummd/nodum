"use client";

/**
 * Promise-based delete confirmation (S11.3) — gated by the user's
 * "Confirm before deleting" pref. Mount <ConfirmDialog /> once (workspace);
 * call confirmDelete(message) from any delete path.
 */

import { create } from "zustand";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseUserPrefs } from "@/lib/hooks/use-editor-settings";
import { useAuthStore } from "@/lib/stores/auth-store";

interface ConfirmState {
  message: string | null;
  resolver: ((ok: boolean) => void) | null;
  request: (message: string) => Promise<boolean>;
  settle: (ok: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  message: null,
  resolver: null,
  request: (message) =>
    new Promise<boolean>((resolve) => {
      // A pending confirm being replaced counts as cancelled
      get().resolver?.(false);
      set({ message, resolver: resolve });
    }),
  settle: (ok) => {
    get().resolver?.(ok);
    set({ message: null, resolver: null });
  },
}));

/** Resolves true when deletion may proceed (immediately if the pref is off). */
export function confirmDelete(message: string): Promise<boolean> {
  const prefs = parseUserPrefs(useAuthStore.getState().user?.settings);
  if (!prefs.confirmDelete) return Promise.resolve(true);
  return useConfirmStore.getState().request(message);
}

export function ConfirmDialog() {
  const message = useConfirmStore((s) => s.message);
  const settle = useConfirmStore((s) => s.settle);

  return (
    <Dialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <DialogContent className="border-ob-border bg-ob-sidebar sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={() => settle(true)}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
