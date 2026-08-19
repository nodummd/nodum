"use client";

/**
 * Vault switcher — the vault name in the sidebar strip, opened into a menu of
 * every vault you own.
 *
 * A vault is a whole separate workspace, so switching opens it in a NEW BROWSER
 * TAB and leaves this one alone. Each row is a real anchor rather than a
 * window.open() call: browsers never block a genuine link click, and ⌘-click,
 * middle-click and "open in new window" all keep working for free.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ExternalLink, Plus, Settings2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { vaultApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

export function VaultSwitcher({ vaultId, vaultName }: { vaultId: string; vaultName: string }) {
  const queryClient = useQueryClient();
  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <DropdownMenu
        // Vaults can be created outside this tab — another browser tab, or an
        // MCP client — so the list is refreshed every time it is opened.
        onOpenChange={(open) => {
          if (open) void queryClient.invalidateQueries({ queryKey: ["vaults"] });
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-tour="vault"
            aria-label={`Vault: ${vaultName}. Switch vault`}
            className="ml-auto flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium tracking-wide text-ob-faint uppercase hover:bg-ob-hover hover:text-ob-text"
          >
            <span className="truncate">{vaultName}</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-70" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-[11px] tracking-wide text-ob-faint uppercase">
            Vaults
          </DropdownMenuLabel>
          {(vaults ?? []).map((v) => (
            <VaultRow key={v.id} vault={v} current={v.id === vaultId} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus className="mr-2 size-3.5 shrink-0" strokeWidth={2} />
            New vault…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSettings("Vault")}>
            <Settings2 className="mr-2 size-3.5 shrink-0" strokeWidth={2} />
            Manage vaults…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewVaultDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function VaultRow({ vault, current }: { vault: Vault; current: boolean }) {
  if (current) {
    return (
      <DropdownMenuItem disabled className="opacity-100">
        <Check className="mr-2 size-3.5 shrink-0 text-ob-accent" strokeWidth={2.5} />
        <span className="truncate">{vault.name}</span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild>
      <a href={`/vault/${vault.id}`} target="_blank" rel="noopener noreferrer">
        <span className="mr-2 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{vault.name}</span>
        <ExternalLink className="ml-auto size-3 shrink-0 opacity-50" strokeWidth={2} />
      </a>
    </DropdownMenuItem>
  );
}

/** Create a vault, then hand back a link rather than calling window.open():
 *  the create is a round-trip, and a popup opened after an await is blocked. */
export function NewVaultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<Vault | null>(null);

  const create = useMutation({
    mutationFn: () => vaultApi.create(name.trim()),
    onSuccess: (vault) => {
      setCreated(vault);
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast(`Vault "${vault.name}" created.`, "info");
    },
    onError: (e) => toastError(e, "Could not create the vault."),
  });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setName("");
      setCreated(null);
      create.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? "Vault created" : "New vault"}</DialogTitle>
          <DialogDescription>
            {created
              ? "A vault is a separate workspace — notes, folders, tags and graph of its own."
              : "It starts empty. Nothing is shared with your other vaults."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <DialogFooter>
            <Button asChild size="sm">
              <a href={`/vault/${created.id}`} target="_blank" rel="noopener noreferrer">
                Open {created.name}
              </a>
            </Button>
          </DialogFooter>
        ) : (
          <>
            <Input
              autoFocus
              aria-label="Vault name"
              placeholder="Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) create.mutate();
              }}
            />
            <DialogFooter>
              <Button
                size="sm"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Create vault
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
