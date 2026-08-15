/**
 * Plugin host — owns the running sandboxes and answers their RPC.
 *
 * Every request is checked against the permissions the user granted BEFORE it
 * reaches an API. The sandbox performs the same check, but that copy is inside
 * the untrusted realm and a plugin can rewrite it, so the host's check is the
 * one that counts.
 */

import { noteApi, vaultApi } from "@/lib/api/endpoints";
import { useToastStore } from "@/lib/stores/toast-store";

import { createSandbox, type SandboxHandle } from "./sandbox";
import {
  isPluginEmit,
  isPluginRequest,
  type InstalledPlugin,
  type Permission,
  type PluginCommand,
} from "./types";

/** Which permission each RPC method requires. Unlisted methods are refused. */
const METHOD_PERMISSION: Record<string, Permission> = {
  "notes.list": "notes:read",
  "notes.get": "notes:read",
  "notes.create": "notes:write",
  "commands.register": "commands:register",
  "ui.notice": "ui:notice",
};

export interface HostOptions {
  vaultId: string;
  /** Called whenever the set of plugin-contributed commands changes. */
  onCommandsChanged: (commands: PluginCommand[]) => void;
  /** Notes changed — let the app refresh its queries. */
  onVaultChanged: () => void;
}

export class PluginHost {
  private sandboxes = new Map<string, SandboxHandle>();
  private commands: PluginCommand[] = [];
  private listener?: (e: MessageEvent) => void;

  constructor(private opts: HostOptions) {}

  start(plugins: InstalledPlugin[]) {
    this.stop();
    this.listener = (e: MessageEvent) => void this.onMessage(e);
    window.addEventListener("message", this.listener);
    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      this.sandboxes.set(plugin.manifest.id, createSandbox(plugin.manifest, plugin.code));
    }
  }

  stop() {
    if (this.listener) window.removeEventListener("message", this.listener);
    this.listener = undefined;
    for (const s of this.sandboxes.values()) s.destroy();
    this.sandboxes.clear();
    if (this.commands.length) {
      this.commands = [];
      this.opts.onCommandsChanged([]);
    }
  }

  runCommand(pluginId: string, commandId: string) {
    this.sandboxes.get(pluginId)?.invoke(commandId);
  }

  /** Identify the sending plugin by frame identity — an opaque-origin frame
   *  posts with origin "null", so origin cannot be used to tell them apart. */
  private senderOf(e: MessageEvent): SandboxHandle | null {
    for (const s of this.sandboxes.values()) {
      if (s.frame.contentWindow === e.source) return s;
    }
    return null;
  }

  private async onMessage(e: MessageEvent) {
    const sender = this.senderOf(e);
    if (!sender) return; // not one of ours
    const data: unknown = e.data;

    if (isPluginEmit(data)) {
      if (data.event === "error") {
        console.warn(`plugin ${sender.manifest.id}:`, data.payload);
      }
      return;
    }
    if (!isPluginRequest(data)) return;

    const reply = (ok: boolean, result?: unknown, error?: string) => {
      sender.frame.contentWindow?.postMessage(
        { nodum: "response", callId: data.callId, ok, result, error },
        "*",
      );
    };

    const needed = METHOD_PERMISSION[data.method];
    if (!needed) return reply(false, undefined, `Unknown method: ${data.method}`);
    if (!sender.manifest.permissions.includes(needed)) {
      return reply(false, undefined, `Permission not granted: ${needed}`);
    }

    try {
      reply(true, await this.dispatch(sender, data.method, data.args));
    } catch (err) {
      reply(false, undefined, err instanceof Error ? err.message : "Plugin call failed");
    }
  }

  private async dispatch(sender: SandboxHandle, method: string, args: unknown[]): Promise<unknown> {
    const { vaultId } = this.opts;
    switch (method) {
      case "notes.list": {
        const tree = await vaultApi.tree(vaultId);
        const out: { id: string; title: string; path: string }[] = [];
        const walk = (items: typeof tree.items) => {
          for (const item of items) {
            if (item.type === "note") out.push({ id: item.id, title: item.title, path: item.path });
            else walk(item.children);
          }
        };
        walk(tree.items);
        return out;
      }
      case "notes.get": {
        const note = await noteApi.get(vaultId, String(args[0]));
        return { id: note.id, title: note.title, path: note.path, content: note.content };
      }
      case "notes.create": {
        const created = await noteApi.create(vaultId, {
          title: String(args[0] ?? "Untitled"),
          content: String(args[1] ?? ""),
        });
        this.opts.onVaultChanged();
        return { id: created.id, title: created.title };
      }
      case "commands.register": {
        const commandId = String(args[0]);
        const label = String(args[1] ?? commandId);
        this.commands = [
          ...this.commands.filter(
            (c) => !(c.pluginId === sender.manifest.id && c.commandId === commandId),
          ),
          { pluginId: sender.manifest.id, commandId, label },
        ];
        this.opts.onCommandsChanged(this.commands);
        return true;
      }
      case "ui.notice": {
        // Namespaced so a plugin can't impersonate the app.
        useToastStore.getState().push(`${sender.manifest.name}: ${String(args[0])}`, "info");
        return true;
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}
