/**
 * Plugin manifest + capability model.
 *
 * Deliberately NOT the Obsidian API. That API is synchronous, DOM-coupled and
 * closed-source, which makes it both unsafe to expose in a multi-tenant web app
 * and impossible to reimplement faithfully. Ours is async and capability-scoped
 * from the start: a plugin can only reach what its manifest asks for and the
 * user grants.
 */

/** Everything a plugin may request. Anything not listed is unreachable. */
export const PERMISSIONS = [
  "notes:read",
  "notes:write",
  "commands:register",
  "ui:notice",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "notes:read": "Read your notes",
  "notes:write": "Create and modify notes",
  "commands:register": "Add commands to the palette",
  "ui:notice": "Show notifications",
};

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions: Permission[];
}

/** An installed plugin as persisted under vault.settings.plugins. */
export interface InstalledPlugin {
  manifest: PluginManifest;
  /** Plugin source. Held inline so a vault is self-contained and offline-safe. */
  code: string;
  enabled: boolean;
  /** Where it came from, for display and re-install. */
  source?: string;
}

/** A command a running plugin contributed to the palette. */
export interface PluginCommand {
  pluginId: string;
  commandId: string;
  label: string;
}

/** RPC envelopes exchanged with the sandbox (structured-clone safe). */
export interface PluginRequest {
  nodum: "request";
  callId: number;
  method: string;
  args: unknown[];
}

export interface PluginResponse {
  nodum: "response";
  callId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface PluginEmit {
  nodum: "emit";
  event: string;
  payload: unknown;
}

export function isPluginRequest(v: unknown): v is PluginRequest {
  return (
    typeof v === "object" && v !== null && (v as PluginRequest).nodum === "request" &&
    typeof (v as PluginRequest).callId === "number" &&
    typeof (v as PluginRequest).method === "string"
  );
}

export function isPluginEmit(v: unknown): v is PluginEmit {
  return (
    typeof v === "object" && v !== null && (v as PluginEmit).nodum === "emit" &&
    typeof (v as PluginEmit).event === "string"
  );
}
