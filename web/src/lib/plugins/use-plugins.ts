"use client";

/** Runs the vault's enabled plugins and exposes their commands to the app. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { vaultApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";

import { PluginHost } from "./host";
import type { InstalledPlugin, PluginCommand } from "./types";

export function usePlugins(vaultId: string) {
  const queryClient = useQueryClient();
  const [commands, setCommands] = useState<PluginCommand[]>([]);
  const hostRef = useRef<PluginHost | null>(null);

  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const plugins = useMemo<InstalledPlugin[]>(() => {
    const v = vaults?.find((x) => x.id === vaultId);
    return ((v?.settings as { plugins?: InstalledPlugin[] } | undefined)?.plugins ?? []);
  }, [vaults, vaultId]);

  const save = useMutation({
    mutationFn: (next: InstalledPlugin[]) =>
      vaultApi.update(vaultId, { settings: { plugins: next } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["vaults"], (old: Vault[] | undefined) =>
        old?.map((v) => (v.id === updated.id ? updated : v)),
      );
    },
  });

  // Restart the host whenever the enabled set or code changes. Keyed on a
  // signature so unrelated vault-settings writes (colours, graph) don't reboot
  // every plugin.
  const signature = JSON.stringify(
    plugins.filter((p) => p.enabled).map((p) => [p.manifest.id, p.manifest.version, p.code.length]),
  );
  useEffect(() => {
    const host = new PluginHost({
      vaultId,
      onCommandsChanged: setCommands,
      onVaultChanged: () => {
        void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
        void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      },
    });
    hostRef.current = host;
    host.start(plugins.filter((p) => p.enabled));
    return () => {
      host.stop();
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, signature]);

  const runCommand = useCallback((pluginId: string, commandId: string) => {
    hostRef.current?.runCommand(pluginId, commandId);
  }, []);

  const setPlugins = useCallback((next: InstalledPlugin[]) => save.mutate(next), [save]);

  return { plugins, commands, runCommand, setPlugins };
}
