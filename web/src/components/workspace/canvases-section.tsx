"use client";

/** Canvases list at the bottom of the file pane — create + open boards. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { confirmDelete } from "./confirm-dialog";
import { canvasApi } from "@/lib/api/endpoints";
import { toastError } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function CanvasesSection({ vaultId }: { vaultId: string }) {
  const queryClient = useQueryClient();
  const openTab = useWorkspaceStore((s) => s.openTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { data: canvases } = useQuery({
    queryKey: ["canvases", vaultId],
    queryFn: () => canvasApi.list(vaultId),
  });

  const create = useMutation({
    mutationFn: (canvasName: string) => canvasApi.create(vaultId, canvasName),
    onSuccess: (canvas) => {
      void queryClient.invalidateQueries({ queryKey: ["canvases", vaultId] });
      openTab({ id: canvas.id, kind: "canvas", title: canvas.name });
      setCreating(false);
      setName("");
    },
    onError: (e) => toastError(e, "Could not create the canvas."),
  });

  const remove = useMutation({
    mutationFn: (canvasId: string) => canvasApi.remove(vaultId, canvasId),
    onSuccess: (_res, canvasId) => {
      void queryClient.invalidateQueries({ queryKey: ["canvases", vaultId] });
      closeTab(canvasId);
    },
    onError: (e) => toastError(e, "Could not delete the canvas."),
  });

  return (
    <div className="shrink-0 border-t border-ob-border p-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          Canvases
        </span>
        <button
          type="button"
          aria-label="New canvas"
          onClick={() => setCreating((v) => !v)}
          className="flex size-5 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      {creating && (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) create.mutate(name.trim());
            if (e.key === "Escape") setCreating(false);
          }}
          placeholder="Canvas name…"
          aria-label="Canvas name"
          className="mb-1 h-7 w-full rounded border border-ob-border bg-ob-bg px-2 text-[12px] text-ob-text outline-none"
        />
      )}
      <div className="max-h-40 overflow-y-auto">
        {canvases?.map((c) => (
          <div key={c.id} className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-ob-hover">
            <LayoutDashboard className="size-3.5 shrink-0 text-ob-faint" strokeWidth={1.75} />
            <button
              type="button"
              onClick={() => openTab({ id: c.id, kind: "canvas", title: c.name })}
              className="min-w-0 flex-1 truncate text-left text-[13px] text-ob-muted hover:text-ob-text"
            >
              {c.name}
            </button>
            <button
              type="button"
              aria-label={`Delete canvas ${c.name}`}
              onClick={() =>
                void confirmDelete(`Delete the canvas “${c.name}”?`).then(
                  (ok) => ok && remove.mutate(c.id),
                )
              }
              className="flex size-5 shrink-0 items-center justify-center rounded text-ob-faint opacity-0 group-hover:opacity-100 hover:text-[#ff8a95]"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        {canvases && canvases.length === 0 && !creating && (
          <p className="px-1.5 text-[11px] text-ob-faint">No canvases yet.</p>
        )}
      </div>
    </div>
  );
}
