/**
 * Live collaboration session — one Y.Doc + y-websocket provider per open
 * note. The server (FastAPI + pycrdt) seeds the doc and persists it; the
 * Y.Text key is "content" on both sides. Feature-gated per vault via
 * settings.collabEnabled.
 */

import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
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
