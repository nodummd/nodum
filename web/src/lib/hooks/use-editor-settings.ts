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

// ── App-wide prefs (S11.3: appearance, files & links, page preview) ─────────

/** Font stacks offered in Appearance — the value is validated against these
 *  keys, so nothing user-supplied ever reaches the CSS var (no injection). */
export const FONT_CHOICES: Record<string, string> = {
  default: "",
  Inter: "Inter, sans-serif",
  System: "system-ui, sans-serif",
  Serif: "Georgia, 'Times New Roman', serif",
  Mono: "'JetBrains Mono', ui-monospace, monospace",
};
export type FontChoice = keyof typeof FONT_CHOICES;
const isFontChoice = (v: unknown): v is FontChoice =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(FONT_CHOICES, v);

export interface UserPrefs {
  /** Hex accent colour override, null = theme default. */
  accentColor: string | null;
  /** Page preview only triggers with ⌘/Ctrl held (Obsidian default). */
  previewRequireCmd: boolean;
  /** Ask before deleting notes, folders and canvases. */
  confirmDelete: boolean;
  /** Font stack keys (validated against FONT_CHOICES). */
  fontInterface: FontChoice;
  fontText: FontChoice;
  fontMonospace: FontChoice;
  /** Interface: left icon ribbon + tab title bar. */
  showRibbon: boolean;
  showTabTitleBar: boolean;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function parseUserPrefs(raw: Record<string, unknown> | undefined): UserPrefs {
  const s = raw ?? {};
  return {
    accentColor: typeof s.accentColor === "string" && HEX_RE.test(s.accentColor) ? s.accentColor : null,
    previewRequireCmd: typeof s.previewRequireCmd === "boolean" ? s.previewRequireCmd : true,
    confirmDelete: typeof s.confirmDelete === "boolean" ? s.confirmDelete : true,
    fontInterface: isFontChoice(s.fontInterface) ? s.fontInterface : "default",
    fontText: isFontChoice(s.fontText) ? s.fontText : "default",
    fontMonospace: isFontChoice(s.fontMonospace) ? s.fontMonospace : "default",
    showRibbon: typeof s.showRibbon === "boolean" ? s.showRibbon : true,
    showTabTitleBar: typeof s.showTabTitleBar === "boolean" ? s.showTabTitleBar : true,
  };
}

export function useUserPrefs(): UserPrefs {
  const user = useAuthStore((s) => s.user);
  return parseUserPrefs(user?.settings);
}
