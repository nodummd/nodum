"use client";

/** Vault dispatcher — sends the user to their active (or first) vault. */

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect } from "react";

import { vaultApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export default function VaultDispatchPage() {
  // `useSearchParams` opts a route out of prerendering unless it sits under a
  // boundary, and this one is prerendered.
  return (
    <Suspense fallback={<Opening />}>
      <Dispatch />
    </Suspense>
  );
}

function Opening() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Opening your vault…</p>
    </main>
  );
}

function Dispatch() {
  const router = useRouter();
  const search = useSearchParams();
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
      // The OAuth callback can only land on /vault, so whatever it left in the
      // query string has to survive this hop or the outcome is lost — which is
      // exactly what used to happen to every "you are connected" and to every
      // reason a connection failed.
      const query = search.toString();
      router.replace(query ? `/vault/${target.id}?${query}` : `/vault/${target.id}`);
    }
  }, [status, vaults, activeVaultId, router, search]);

  return <Opening />;
}
