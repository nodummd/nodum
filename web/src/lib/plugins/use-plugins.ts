"use client";

/** Runs the vault's enabled plugins and exposes their commands to the app. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { vaultApi } from "@/lib/api/endpoints";
import type { Vault } from "@/lib/api/types";

import { PluginHost } from "./host";
import { usePluginCommandStore } from "./command-store";
import type { InstalledPlugin } from "./types";

/**
 * @param run  Only ONE caller may run the host. The settings tab reads the
 *   same registry to list and toggle plugins, and if it booted its own host
 *   every plugin would run twice — two sandboxes, duplicated commands and
 *   doubled RPC. The workspace owns the host; everyone else passes false.
 */
export function usePlugins(vaultId: string, { run = false }: { run?: boolean } = {}) {
  const queryClient = useQueryClient();
  const commands = usePluginCommandStore((s) => s.commands);
  const setCommands = usePluginCommandStore((s) => s.setCommands);
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
    if (!run) return;
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
  }, [vaultId, signature, run]);

  const runCommand = useCallback((pluginId: string, commandId: string) => {
    hostRef.current?.runCommand(pluginId, commandId);
  }, []);

  const setPlugins = useCallback((next: InstalledPlugin[]) => save.mutate(next), [save]);

  return { plugins, commands, runCommand, setPlugins };
}
