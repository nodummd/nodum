"use client";

/** Workspace route — loads the vault and renders the Obsidian-style frame. */

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Workspace } from "@/components/workspace/workspace";
import { vaultApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export default function WorkspacePage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const setActiveVault = useWorkspaceStore((s) => s.setActiveVault);
  const activeVaultId = useWorkspaceStore((s) => s.activeVaultId);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (vaultId) setActiveVault(vaultId);
  }, [vaultId, setActiveVault]);
  // The store must point at THIS vault before the workspace mounts. Child
  // effects run before a parent's, so a workspace mounted early would write
  // its first tabs (the ?note= open, the default-mode mirror) under the vault
  // we just came from — and the layout swap below would then wipe them.
  const storeReady = activeVaultId === vaultId;

  const { data: vaults } = useQuery({
    queryKey: ["vaults"],
    queryFn: vaultApi.list,
    enabled: status === "authenticated",
  });
  const vault = vaults?.find((v) => v.id === vaultId);

  if (status !== "authenticated" || !vault || !storeReady) {
    return (
      <main className="flex h-screen items-center justify-center bg-ob-bg">
        <p className="text-[13px] text-ob-faint">Loading vault…</p>
      </main>
    );
  }

  // Keyed by vault: changing vault inside one tab is a whole new workspace, and
  // the per-vault imperative state (CodeMirror drafts, collab sockets, the
  // plugin host) has to be torn down rather than re-pointed.
  return <Workspace key={vault.id} vault={vault} />;
}
