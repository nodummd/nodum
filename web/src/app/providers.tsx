"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/lib/stores/auth-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const bootstrap = useAuthStore((s) => s.bootstrap);
  // The query cache belongs to one identity. When it changes — logout, expiry,
  // or a different account logging in — everything cached (vault list, notes,
  // trees) is that person's and must go, or the next account lands in the
  // previous one's vault with their notes still on screen.
  // The first loading → authenticated step at boot is not a change of
  // identity — nothing from anyone else can be cached yet — and clearing then
  // would silently destroy queries already in flight on public pages
  // (/p/<token>, /login), which never notify their observers.
  useEffect(() => {
    const init = useAuthStore.getState();
    let last: string | null | undefined =
      init.status === "loading" ? undefined : (init.user?.id ?? null);
    return useAuthStore.subscribe((s) => {
      if (s.status === "loading") return;
      const id = s.status === "authenticated" ? (s.user?.id ?? null) : null;
      if (last !== undefined && id !== last) queryClient.clear();
      last = id;
    });
  }, [queryClient]);
  useEffect(() => {
    void bootstrap();
    // PWA app-shell service worker — production only (caching fights next dev)
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }
  }, [bootstrap]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
