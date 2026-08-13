"use client";

/** User-level editor preferences (users.settings JSONB), validated with defaults. */

import { useAuthStore } from "@/lib/stores/auth-store";

export type EditorViewMode = "live" | "source" | "reading";

export interface EditorSettings {
  defaultViewMode: EditorViewMode;
  readableLineLength: boolean;
  showLineNumbers: boolean;
  spellcheck: boolean;
  /** px, clamped to 14–24. */
  editorFontSize: number;
}

export const EDITOR_SETTING_DEFAULTS: EditorSettings = {
  defaultViewMode: "live",
  readableLineLength: true,
  showLineNumbers: false,
  spellcheck: false,
  editorFontSize: 16,
};

const VIEW_MODES: EditorViewMode[] = ["live", "source", "reading"];

export function parseEditorSettings(raw: Record<string, unknown> | undefined): EditorSettings {
  const s = raw ?? {};
  const mode = s.defaultViewMode;
  const size = Number(s.editorFontSize);
  return {
    defaultViewMode: VIEW_MODES.includes(mode as EditorViewMode)
      ? (mode as EditorViewMode)
      : EDITOR_SETTING_DEFAULTS.defaultViewMode,
    readableLineLength:
      typeof s.readableLineLength === "boolean"
        ? s.readableLineLength
        : EDITOR_SETTING_DEFAULTS.readableLineLength,
    showLineNumbers:
      typeof s.showLineNumbers === "boolean"
        ? s.showLineNumbers
        : EDITOR_SETTING_DEFAULTS.showLineNumbers,
    spellcheck:
      typeof s.spellcheck === "boolean" ? s.spellcheck : EDITOR_SETTING_DEFAULTS.spellcheck,
    editorFontSize: Number.isFinite(size)
      ? Math.min(24, Math.max(14, size))
      : EDITOR_SETTING_DEFAULTS.editorFontSize,
  };
}

export function useEditorSettings(): EditorSettings {
  const user = useAuthStore((s) => s.user);
  return parseEditorSettings(user?.settings);
}
