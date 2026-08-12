"use client";

/**
 * Workspace shell — placeholder proving the auth + data plumbing end to end.
 * The full Obsidian-style layout (explorer, tabs, editor, panels, graph)
 * lands in feature/web-vault-ui and feature/web-editor.
 */

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { vaultApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export default function WorkspacePage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setActiveVault = useWorkspaceStore((s) => s.setActiveVault);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (vaultId) setActiveVault(vaultId);
  }, [vaultId, setActiveVault]);

  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
    enabled: status === "authenticated" && Boolean(vaultId),
  });

  if (status !== "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">nodum · workspace</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{user?.name}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
              router.replace("/");
            }}
          >
            Log out
          </Button>
        </div>
      </header>
      <section className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-lg font-semibold">Vault loaded ✓</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tree ? `${tree.items.length} top-level items` : "Fetching tree…"}
        </p>
        <ul className="mt-6 space-y-1 text-sm">
          {tree?.items.map((item) => (
            <li key={item.id} className="rounded-md border bg-card px-3 py-2">
              {item.type === "folder" ? "📁 " : "📄 "}
              {item.type === "folder" ? item.name : item.title}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
