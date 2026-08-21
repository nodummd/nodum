"use client";

/** Bounce an already-signed-in visitor from the landing page into the app.
 *
 *  The root providers run the auth bootstrap on every page, marketing
 *  included; the moment it resolves to "authenticated" the landing page is
 *  the wrong place. Renders nothing either way, so the page stays static
 *  and crawlable for everyone else.
 *
 *  (Recreated: the SEO branch shipped the import but this file was never
 *  committed — it lived untracked in a since-deleted worktree.)
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuthStore } from "@/lib/stores/auth-store";

export function RedirectAuthenticated() {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();
  useEffect(() => {
    if (status === "authenticated") router.replace("/vault");
  }, [status, router]);
  return null;
}
