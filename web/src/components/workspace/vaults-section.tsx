"use client";

/** Settings → Vault: the list of vaults, with rename, delete and create.
 *  Opening another vault is a link, not a button — see vault-switcher.tsx. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { confirmDelete } from "./confirm-dialog";
import { useCreateDemoWorkspace } from "./demo-workspace-offer";
import { NewVaultDialog } from "./vault-switcher";
import { ImportDialog } from "@/components/import/import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { vaultApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

export function VaultsSection({ vaultId }: { vaultId: string }) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const createDemo = useCreateDemoWorkspace();

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => vaultApi.update(id, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast("Vault renamed.", "info");
    },
    onError: (e) => toastError(e, "Could not rename the vault."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => vaultApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast("Vault deleted.", "info");
    },
    onError: (e) => toastError(e, "Could not delete the vault."),
  });

  const list = vaults ?? [];
  const isLast = list.length <= 1;

  const submitRename = (vault: Vault) => {
    const next = (names[vault.id] ?? vault.name).trim();
    setNames((n) => ({ ...n, [vault.id]: next }));
    if (next && next !== vault.name) rename.mutate({ id: vault.id, name: next });
    else setNames((n) => ({ ...n, [vault.id]: vault.name }));
  };

  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Vaults</h3>
      <p className="text-[12px] text-ob-faint">
        Each vault is a separate workspace — its own notes, folders, tags and graph. Opening one
        launches it in a new browser tab, so you can work in two at once.
      </p>
      <ul className="space-y-1.5">
        {list.map((v) => (
          <li key={v.id} className="flex items-center gap-2">
            <Input
              aria-label={`Vault name: ${v.name}`}
              value={names[v.id] ?? v.name}
              onChange={(e) => setNames((n) => ({ ...n, [v.id]: e.target.value }))}
              onBlur={() => submitRename(v)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className={cn("h-8", v.id === vaultId && "border-ob-accent")}
            />
            {v.id === vaultId ? (
              <span className="shrink-0 px-1 text-[11px] tracking-wide text-ob-faint uppercase">
                Open here
              </span>
            ) : (
              <Button asChild size="sm" variant="ghost" className="shrink-0">
                <a href={`/vault/${v.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 size-3.5" strokeWidth={2} />
                  Open
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete vault ${v.name}`}
              // The backend cascade-deletes every note in the vault and has no
              // guard against deleting the last one, which would strand the
              // user on a dispatcher with nowhere to send them.
              disabled={isLast || remove.isPending}
              onClick={() =>
                void confirmDelete(
                  `Delete "${v.name}"? Every note, folder, tag and canvas in it goes too. This cannot be undone.`,
                ).then((ok) => {
                  if (ok) remove.mutate(v.id);
                })
              }
              className="shrink-0 text-ob-faint hover:text-red-400"
            >
              <Trash2 className="size-3.5" strokeWidth={2} />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus className="mr-1 size-3.5" strokeWidth={2} />
          New vault
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={createDemo.isPending}
          onClick={() => createDemo.mutate()}
        >
          <Sparkles className="mr-1 size-3.5" strokeWidth={2} />
          {createDemo.isPending ? "Creating demo…" : "Create a demo workspace"}
        </Button>
      </div>
      <p className="text-[12px] text-ob-faint">
        The demo is a separate vault with 200+ linked notes, coloured folders and graph groups —
        a safe place to try things.
      </p>

      {/* Import lives here rather than only in the command palette: someone
          arriving from another app is looking for a button, not a shortcut
          they have not learned yet. */}
      <div className="border-t border-ob-border pt-3">
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          Bring your notes in
        </h3>
        <p className="mt-1.5 text-[12px] text-ob-faint">
          Obsidian, Notion, Evernote, Apple Notes, Google Keep, Roam, Slack and more — everything
          arrives as plain markdown, with links resolved across the whole import.
        </p>
        <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => setImporting(true)}>
          <Download className="mr-1 size-3.5" strokeWidth={2} />
          Import data
        </Button>
      </div>

      <NewVaultDialog open={creating} onOpenChange={setCreating} />
      <ImportDialog vaultId={vaultId} open={importing} onOpenChange={setImporting} />
    </section>
  );
}
