"use client";

/**
 * The floating progress card for a running sync.
 *
 * Backfill state lives on the server (`records_seen`, `backfill_done` per
 * stream), so this survives reloads for free: come back mid-import and the
 * card is simply there again, counting. While a backfill runs the card stays
 * up — pause and "keep future only" are the controls someone mid-regret needs
 * — and once everything is caught up it turns into a closable "done" notice.
 *
 * The count is a number that goes up, not a bar: neither Google API says how
 * much history exists, so a percentage would be invented.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pause, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmDelete } from "@/components/workspace/confirm-dialog";
import { connectionsApi, type ProviderConnection } from "@/lib/api/endpoints";
import { toastError } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

function backfilling(connection: ProviderConnection): boolean {
  return connection.streams.some((s) => !s.backfill_done);
}

function seenTotal(connection: ProviderConnection): number {
  return connection.streams.reduce((total, s) => total + (s.records_seen || 0), 0);
}

export function SyncProgressCard({ vaultId }: { vaultId: string }) {
  const queryClient = useQueryClient();
  const setImportOpen = useWorkspaceStore((s) => s.setImportOpen);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const watched = useWorkspaceStore((s) => s.syncWatched);
  const markSyncWatched = useWorkspaceStore((s) => s.markSyncWatched);

  const { data } = useQuery({
    queryKey: ["sync-connections"],
    queryFn: () => connectionsApi.list(),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => c.streams.some((s) => s.syncing || !s.backfill_done))
        ? 3000
        : false,
  });

  const mine = (data ?? []).filter((c) => c.vault_id === vaultId);
  const running = mine.filter((c) => backfilling(c) && c.status !== "paused");
  const paused = mine.filter((c) => backfilling(c) && c.status === "paused");

  useEffect(() => {
    // Zustand, not component state: the store's setter is a no-op when every
    // id is already recorded, and the watched set outliving this component
    // means navigating away mid-import does not forfeit the finished notice.
    markSyncWatched([...running, ...paused].map((connection) => connection.id));
  }, [running, paused, markSyncWatched]);

  const finished = mine.filter((c) => watched[c.id] && !backfilling(c) && !closed.has(c.id));

  const pause = useMutation({
    mutationFn: (id: string) => connectionsApi.pause(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sync-connections"] }),
    onError: (e) => toastError(e, "Could not pause."),
  });
  const resume = useMutation({
    mutationFn: (id: string) => connectionsApi.resume(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sync-connections"] }),
    onError: (e) => toastError(e, "Could not resume."),
  });
  const stop = useMutation({
    mutationFn: (id: string) => connectionsApi.skipBackfill(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sync-connections"] }),
    onError: (e) => toastError(e, "Could not stop the import."),
  });

  const active = [...running, ...paused, ...finished];
  if (active.length === 0) return null;

  return (
    <div
      className="fixed right-4 bottom-10 z-40 w-[300px] rounded-lg border border-ob-border bg-ob-sidebar shadow-lg"
      role="status"
      aria-label="Sync progress"
      data-testid="sync-progress"
    >
      {active.map((connection) => {
        const isPaused = connection.status === "paused";
        const isDone = !backfilling(connection);
        const seen = seenTotal(connection);
        return (
          <div
            key={connection.id}
            className="border-b border-ob-border p-3 last:border-b-0"
            data-testid="sync-progress-row"
          >
            <div className="flex items-center gap-2">
              {isDone ? (
                <Check className="size-4 shrink-0 text-green-500" />
              ) : isPaused ? (
                <Pause className="size-4 shrink-0 text-ob-faint" />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-ob-accent" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-ob-text">
                  {isDone
                    ? `${connection.provider_name} import finished`
                    : isPaused
                      ? `${connection.provider_name} import paused`
                      : `Importing ${connection.provider_name}…`}
                </p>
                <p className="text-[11px] text-ob-faint">
                  {isDone
                    ? `${seen.toLocaleString()} items — new ones keep syncing on their own`
                    : seen > 0
                      ? `${seen.toLocaleString()} items so far`
                      : "Starting…"}
                </p>
              </div>
              {isDone && (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setClosed((current) => new Set(current).add(connection.id))}
                  className="rounded p-1 text-ob-faint hover:bg-ob-hover hover:text-ob-text"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {!isDone && (
              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  disabled={pause.isPending || resume.isPending}
                  onClick={() =>
                    isPaused ? resume.mutate(connection.id) : pause.mutate(connection.id)
                  }
                >
                  {isPaused ? <Play className="mr-1 size-3" /> : <Pause className="mr-1 size-3" />}
                  {isPaused ? "Resume" : "Pause"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  disabled={stop.isPending}
                  onClick={() => {
                    void confirmDelete(
                      "Stop importing history? Notes already imported are kept, and new items keep syncing from now on.",
                      "Keep future only",
                    ).then((ok) => {
                      if (ok) stop.mutate(connection.id);
                    });
                  }}
                >
                  Keep future only
                </Button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="ml-auto text-[11px] text-ob-faint hover:text-ob-text"
                >
                  Details
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
