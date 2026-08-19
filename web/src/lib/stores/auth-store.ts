"use client";

/** Auth state — user + bootstrap status. Access token lives in the api client. */

import { create } from "zustand";

import { authApi } from "@/lib/api/endpoints";
import { onAuthExpired, setAccessToken } from "@/lib/api/client";
import type { TokenPair, User } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Try to restore the session from the refresh cookie (app boot). */
  bootstrap: () => Promise<void>;
  applyTokens: (pair: TokenPair) => void;
  /** Replace the cached user (e.g. after PATCH /auth/me). */
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => {
  // Hard 401 (refresh failed mid-use) → drop to anonymous; route guards redirect.
  onAuthExpired(() => {
    useWorkspaceStore.getState().resetForSignOut();
    set({ status: "anonymous", user: null });
  });

  return {
  status: "loading",
  user: null,

  bootstrap: async () => {
    try {
      const pair = await authApi.refresh();
      setAccessToken(pair.access_token);
      set({ status: "authenticated", user: pair.user });
    } catch {
      setAccessToken(null);
      set({ status: "anonymous", user: null });
    }
  },

  applyTokens: (pair) => {
    setAccessToken(pair.access_token);
    set({ status: "authenticated", user: pair.user });
  },

  setUser: (user) => set({ user }),

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      /* logout must always succeed client-side */
    }
    setAccessToken(null);
    // Whoever logs in next on this browser must not inherit this account's
    // open vault, open dialogs or the tour's state.
    useWorkspaceStore.getState().resetForSignOut();
    set({ status: "anonymous", user: null });
  },
  };
});
