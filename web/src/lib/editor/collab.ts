/**
 * Live collaboration session — one Y.Doc + y-websocket provider per open
 * note. The server (FastAPI + pycrdt) seeds the doc and persists it; the
 * Y.Text key is "content" on both sides. Feature-gated per vault via
 * settings.collabEnabled.
 */

import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";

import { getAccessToken, refreshAccessToken } from "@/lib/api/client";
import * as Y from "yjs";

/** Deterministic presence color per user (Obsidian-ish palette). */
const PRESENCE_COLORS = [
  "#eb3b5a",
  "#fa8231",
  "#f7b731",
  "#20bf6b",
  "#0fb9b1",
  "#2d98da",
  "#8854d0",
];

export function presenceColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

export interface CollabSession {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  ytext: Y.Text;
  destroy: () => void;
}

export function createCollabSession(
  vaultId: string,
  noteId: string,
  token: string,
  user: { name: string; color: string },
  /** Called when the socket drops after a successful sync. The caller must
   * rebuild the session with a FRESH doc — re-syncing an old doc against a
   * re-seeded server room merges two independent insertions of the same
   * text and duplicates the note. */
  onStale?: () => void,
): CollabSession {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const base = `${proto}://${window.location.host}/api/v1/vaults/${vaultId}/notes`;
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(base, `${noteId}/collab`, ydoc, {
    params: { token },
  });
  provider.awareness.setLocalStateField("user", {
    name: user.name,
    color: user.color,
    colorLight: `${user.color}33`,
  });
  let syncedOnce = false;
  provider.on("sync", (synced: boolean) => {
    if (synced) {
      syncedOnce = true;
      rejections = 0;
    }
  });
  provider.on("status", ({ status }: { status: string }) => {
    if (status === "disconnected" && syncedOnce && onStale) onStale();
  });

  // The token is captured once at construction, but y-websocket rebuilds the
  // URL from `params` on EVERY reconnect — so after the access token's short
  // lifetime every retry presents a dead JWT and the server rejects the
  // handshake (403), forever, at the backoff interval. Refresh before retrying.
  //
  // "connection-close" is the only event emitted for a REJECTED handshake:
  // "status" fires solely from inside `if (provider.wsconnected)`, which never
  // becomes true when the upgrade itself is refused.
  let rejections = 0;
  provider.on("connection-close", () => {
    void (async () => {
      rejections += 1;
      // Give up rather than hammer the server with a token it keeps refusing.
      if (rejections > 5) {
        provider.disconnect();
        if (onStale) onStale();
        return;
      }
      if (await refreshAccessToken()) {
        const fresh = getAccessToken();
        if (fresh) provider.params.token = fresh; // read by the next retry
      }
    })();
  });
  return {
    ydoc,
    provider,
    ytext: ydoc.getText("content"),
    destroy: () => {
      provider.destroy();
      ydoc.destroy();
    },
  };
}

/** CodeMirror extension binding the editor to the session (cursors included). */
export function collabExtension(session: CollabSession) {
  return yCollab(session.ytext, session.provider.awareness);
}
