"use client";

/** Vault-level settings (vaults.settings JSONB), validated with defaults. */

import { useQuery } from "@tanstack/react-query";

import { vaultApi } from "@/lib/api/endpoints";

export type CanvasBackground = "dots" | "grid" | "blank";

export interface VaultSettings {
  /** Canvas board background pattern. */
  canvasBackground: CanvasBackground;
}

export const VAULT_SETTING_DEFAULTS: VaultSettings = {
  canvasBackground: "dots",
};

const CANVAS_BACKGROUNDS: CanvasBackground[] = ["dots", "grid", "blank"];

export function parseVaultSettings(raw: Record<string, unknown> | undefined): VaultSettings {
  const s = raw ?? {};
  const bg = s.canvasBackground;
  return {
    canvasBackground: CANVAS_BACKGROUNDS.includes(bg as CanvasBackground)
      ? (bg as CanvasBackground)
      : VAULT_SETTING_DEFAULTS.canvasBackground,
  };
}

export function useVaultSettings(vaultId: string): VaultSettings {
  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const vault = vaults?.find((v) => v.id === vaultId);
  return parseVaultSettings(vault?.settings as Record<string, unknown> | undefined);
}
