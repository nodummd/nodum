"use client";

/** Vault dispatcher — sends the user to their active (or first) vault. */

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { vaultApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export default function VaultDispatchPage() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const activeVaultId = useWorkspaceStore((s) => s.activeVaultId);

  const { data: vaults } = useQuery({
    queryKey: ["vaults"],
    queryFn: vaultApi.list,
    enabled: status === "authenticated",
  });

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
      return;
    }
    if (!vaults) return;
    const target = vaults.find((v) => v.id === activeVaultId) ?? vaults[0];
    if (target) {
      router.replace(`/vault/${target.id}`);
    }
  }, [status, vaults, activeVaultId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Opening your vault…</p>
    </main>
  );
}
