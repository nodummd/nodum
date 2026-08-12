"use client";

/** Version history dialog — lists server-side snapshots, restores one. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { versionApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

export function VersionHistoryDialog({
  vaultId,
  noteId,
  open,
  onOpenChange,
  onRestored,
}: {
  vaultId: string;
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (note: Note) => void;
}) {
  const queryClient = useQueryClient();
  const { data: versions, isFetching } = useQuery({
    queryKey: ["versions", vaultId, noteId],
    queryFn: () => versionApi.list(vaultId, noteId),
    enabled: open,
  });

  const restore = useMutation({
    mutationFn: (versionId: string) => versionApi.restore(vaultId, noteId, versionId),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["versions", vaultId, noteId] });
      onRestored(note);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-ob-border bg-[var(--ob-color-base-25)] sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] text-ob-text">
            <History className="size-4" strokeWidth={1.75} /> Version history
          </DialogTitle>
          <DialogDescription className="text-[12px] text-ob-faint">
            Snapshots are taken on save, at most one per 5 minutes. Restoring keeps a snapshot of
            the current text.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[320px] space-y-1 overflow-y-auto">
          {versions && versions.length === 0 && !isFetching && (
            <p className="px-1 py-2 text-[13px] text-ob-faint">No versions yet — keep editing.</p>
          )}
          {versions?.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-ob-hover"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ob-text">{formatWhen(v.created_at)}</div>
                <div className="text-[11px] text-ob-faint">
                  {v.title} · {v.size_chars.toLocaleString()} chars
                </div>
              </div>
              <button
                type="button"
                onClick={() => restore.mutate(v.id)}
                disabled={restore.isPending}
                className="shrink-0 rounded border border-ob-border px-2 py-0.5 text-[12px] text-ob-muted hover:bg-ob-active hover:text-ob-text disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
