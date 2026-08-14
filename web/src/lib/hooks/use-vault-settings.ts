"use client";

/** Vault-level settings (vaults.settings JSONB), validated with defaults. */

import { useQuery } from "@tanstack/react-query";

import { vaultApi } from "@/lib/api/endpoints";

export type CanvasBackground = "dots" | "grid" | "blank";
export type LinkFormat = "shortest" | "relative" | "absolute";

export interface VaultSettings {
  /** Canvas board background pattern. */
  canvasBackground: CanvasBackground;
  /** Files & links (stored + surfaced; deeper wiring is incremental). */
  attachmentFolder: string;
  linkFormat: LinkFormat;
  useWikilinks: boolean;
  excludedPaths: string[];
}

export const VAULT_SETTING_DEFAULTS: VaultSettings = {
  canvasBackground: "dots",
  attachmentFolder: "",
  linkFormat: "shortest",
  useWikilinks: true,
  excludedPaths: [],
};

const CANVAS_BACKGROUNDS: CanvasBackground[] = ["dots", "grid", "blank"];
const LINK_FORMATS: LinkFormat[] = ["shortest", "relative", "absolute"];

export function parseVaultSettings(raw: Record<string, unknown> | undefined): VaultSettings {
  const s = raw ?? {};
  return {
    canvasBackground: CANVAS_BACKGROUNDS.includes(s.canvasBackground as CanvasBackground)
      ? (s.canvasBackground as CanvasBackground)
      : VAULT_SETTING_DEFAULTS.canvasBackground,
    attachmentFolder: typeof s.attachmentFolder === "string" ? s.attachmentFolder : "",
    linkFormat: LINK_FORMATS.includes(s.linkFormat as LinkFormat)
      ? (s.linkFormat as LinkFormat)
      : VAULT_SETTING_DEFAULTS.linkFormat,
    useWikilinks: typeof s.useWikilinks === "boolean" ? s.useWikilinks : true,
    excludedPaths: Array.isArray(s.excludedPaths)
      ? s.excludedPaths.filter((p): p is string => typeof p === "string")
      : [],
  };
}

export function useVaultSettings(vaultId: string): VaultSettings {
  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const vault = vaults?.find((v) => v.id === vaultId);
  return parseVaultSettings(vault?.settings as Record<string, unknown> | undefined);
}
