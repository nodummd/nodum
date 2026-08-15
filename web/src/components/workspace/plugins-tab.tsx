"use client";

/**
 * Plugins settings tab — the local registry.
 *
 * Installing means pasting a manifest + source. There is no remote registry
 * yet, and that is deliberate: a marketplace that ships arbitrary code needs
 * review and revocation, which is a product decision rather than a component.
 * The permission list is shown before install so granting is a conscious act.
 */

import { useState } from "react";

import { usePlugins } from "@/lib/plugins/use-plugins";
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  type InstalledPlugin,
  type Permission,
  type PluginManifest,
} from "@/lib/plugins/types";
import { useToastStore } from "@/lib/stores/toast-store";

/** Accepts `{ "manifest": {...}, "code": "..." }` or a manifest with `code`. */
function parseBundle(raw: string): InstalledPlugin | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "That isn’t valid JSON.";
  }
  const obj = parsed as Record<string, unknown>;
  const manifest = (obj.manifest ?? obj) as Partial<PluginManifest>;
  const code = typeof obj.code === "string" ? obj.code : "";
  if (!manifest.id || !manifest.name || !manifest.version) {
    return "The manifest needs at least id, name and version.";
  }
  if (!code.trim()) return "The bundle has no code.";
  const requested = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const unknown = requested.filter((p) => !PERMISSIONS.includes(p as Permission));
  if (unknown.length) return `Unknown permission: ${unknown.join(", ")}`;
  return {
    manifest: {
      id: String(manifest.id),
      name: String(manifest.name),
      version: String(manifest.version),
      description: manifest.description ? String(manifest.description) : undefined,
      author: manifest.author ? String(manifest.author) : undefined,
      permissions: requested as Permission[],
    },
    code,
    enabled: false, // never auto-enable freshly pasted code
    source: "pasted",
  };
}

export function PluginsTab({ vaultId }: { vaultId: string }) {
  const { plugins, commands, setPlugins } = usePlugins(vaultId);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const toast = useToastStore((s) => s.push);

  const install = () => {
    const result = parseBundle(draft);
    if (typeof result === "string") {
      toast(result, "error");
      return;
    }
    const next = [...plugins.filter((p) => p.manifest.id !== result.manifest.id), result];
    setPlugins(next);
    setDraft("");
    setAdding(false);
    toast(`Installed ${result.manifest.name} — enable it to run`, "info");
  };

  const toggle = (id: string, enabled: boolean) =>
    setPlugins(plugins.map((p) => (p.manifest.id === id ? { ...p, enabled } : p)));

  const remove = (id: string) => setPlugins(plugins.filter((p) => p.manifest.id !== id));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          Installed plugins
        </h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded border border-ob-border px-2 py-1 text-[12px] text-ob-muted hover:text-ob-text"
        >
          {adding ? "Cancel" : "Install…"}
        </button>
      </div>

      <p className="text-[12px] text-ob-faint">
        Plugins run in a sandbox with no access to your session, and can only use the permissions
        you grant. They cannot reach the network.
      </p>

      {adding && (
        <div className="space-y-2 rounded border border-ob-border p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={'{"manifest":{"id":"demo","name":"Demo","version":"1.0.0","permissions":["ui:notice"]},"code":"nodum.ui.notice(\'hi\')"}'}
            className="w-full rounded border border-ob-border bg-ob-bg p-2 font-mono text-[11px] text-ob-text outline-none focus:border-ob-accent"
          />
          <button
            type="button"
            onClick={install}
            className="rounded bg-ob-accent px-2 py-1 text-[12px] text-white"
          >
            Install
          </button>
        </div>
      )}

      {plugins.length === 0 && (
        <p className="text-[13px] text-ob-faint">No plugins installed.</p>
      )}

      <ul className="space-y-2">
        {plugins.map((p) => {
          const mine = commands.filter((c) => c.pluginId === p.manifest.id);
          return (
            <li key={p.manifest.id} className="rounded border border-ob-border p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ob-text">
                    {p.manifest.name}{" "}
                    <span className="text-[11px] font-normal text-ob-faint">
                      v{p.manifest.version}
                    </span>
                  </p>
                  {p.manifest.description && (
                    <p className="text-[12px] text-ob-muted">{p.manifest.description}</p>
                  )}
                  <p className="mt-1 text-[11px] text-ob-faint">
                    {p.manifest.permissions.length === 0
                      ? "No permissions requested"
                      : p.manifest.permissions
                          .map((perm) => PERMISSION_LABELS[perm] ?? perm)
                          .join(" · ")}
                  </p>
                  {p.enabled && mine.length > 0 && (
                    <p className="mt-1 text-[11px] text-ob-faint">
                      Commands: {mine.map((c) => c.label).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1 text-[12px] text-ob-muted">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => toggle(p.manifest.id, e.target.checked)}
                      className="accent-[var(--ob-interactive-accent)]"
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${p.manifest.name}`}
                    onClick={() => remove(p.manifest.id)}
                    className="text-[12px] text-ob-faint hover:text-ob-text"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
