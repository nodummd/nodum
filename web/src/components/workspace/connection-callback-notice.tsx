"use client";

/**
 * What the user sees after coming back from Google's consent screen.
 *
 * The callback cannot talk to the app except through the URL it redirects to,
 * and until this existed the app ignored it completely: you approved the
 * permissions, landed on your vault, and nothing happened. Worse on failure —
 * the whole diagnosis pipeline ran, produced the one message that fixes a
 * seven-day Testing-mode grant, put it in the URL, and threw it away.
 *
 * The wording lives here rather than in the URL on purpose. Anyone can send
 * someone to `/vault?connected=failed&reason=…`; if that text were rendered,
 * an attacker could put their own prose inside the app's chrome without
 * needing an XSS at all. So the server sends a code from a closed set and the
 * client owns the words — an unrecognised code gets generic copy rather than
 * being echoed back.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useToastStore } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const REASONS: Record<string, string> = {
  no_refresh_token:
    "Google did not return the permission needed to keep syncing in the background. Remove Nodum from your Google account permissions, then connect again.",
  no_scopes:
    "No usable permissions were granted. Connect again and leave the requested permissions ticked.",
  no_encryption_key:
    "This server has no encryption key set, so Google tokens cannot be stored safely. The administrator needs to set OAUTH_ENCRYPTION_KEY.",
  no_identity: "Google would not confirm which account this is. Try connecting again.",
  code_rejected: "Google rejected the authorisation. Try connecting again.",
  google_unreachable: "Could not reach Google. This is usually temporary — try again in a moment.",
  vault_gone: "That vault no longer exists, so there was nothing to connect it to.",
  google_error: "Google could not complete the connection. Try again.",
  crashed: "Something went wrong completing the connection. Try again.",
};

const FALLBACK = "Could not finish connecting your Google account. Please try again.";

export function ConnectionCallbackNotice() {
  const search = useSearchParams();
  const router = useRouter();
  const push = useToastStore((s) => s.push);
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  // React runs effects twice in development, and a duplicate toast reads as a
  // duplicate failure.
  const handled = useRef("");

  const outcome = search.get("connected");
  const reason = search.get("reason") ?? "";

  useEffect(() => {
    if (!outcome) return;
    const key = `${outcome}:${reason}`;
    if (handled.current === key) return;
    handled.current = key;

    if (outcome === "ok") {
      push("Google account connected. The first sync has started.", "info");
      // Land them where the result actually shows up, rather than on a vault
      // that looks no different than before.
      openSettings("Connections");
    } else if (outcome === "denied") {
      push("Connection cancelled — nothing was changed.", "info");
    } else if (outcome === "expired") {
      push("That connection attempt expired before it finished. Please try again.", "error");
    } else {
      push(REASONS[reason] ?? FALLBACK, "error");
    }

    // Strip the params so a refresh, a back button or a shared link does not
    // replay an outcome that already happened.
    const rest = new URLSearchParams(search.toString());
    rest.delete("connected");
    rest.delete("reason");
    const query = rest.toString();
    router.replace(query ? `${window.location.pathname}?${query}` : window.location.pathname, {
      scroll: false,
    });
  }, [outcome, reason, search, push, openSettings, router]);

  return null;
}
