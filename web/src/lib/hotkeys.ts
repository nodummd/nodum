/**
 * Every nodum command, for the Hotkeys reference tab (S12.1).
 *
 * `keys` is the keyboard chord when one is bound; an empty string means the
 * command is run from the command palette (⌘P) or the noted UI gesture.
 * Grouped Obsidian-style by section.
 */

export interface HotkeyEntry {
  section: string;
  keys: string;
  action: string;
}

export const HOTKEYS: HotkeyEntry[] = [
  // ── Navigation ────────────────────────────────────────────────────────────
  { section: "Navigation", keys: "⌘O", action: "Quick switcher: open" },
  { section: "Navigation", keys: "⌘P", action: "Command palette: open" },
  { section: "Navigation", keys: "⌘G", action: "Graph view: open" },
  { section: "Navigation", keys: "", action: "Search in all files" },
  { section: "Navigation", keys: "⌘[", action: "Navigate back" },
  { section: "Navigation", keys: "⌘]", action: "Navigate forward" },
  { section: "Navigation", keys: "⌘ / Ctrl + hover", action: "Page preview of a wikilink" },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  { section: "Tabs", keys: "⌘W", action: "Close current tab" },
  { section: "Tabs", keys: "", action: "Close all other tabs" },
  { section: "Tabs", keys: "", action: "Go to next tab" },
  { section: "Tabs", keys: "", action: "Go to previous tab" },
  { section: "Tabs", keys: "⌘1 … ⌘8", action: "Go to tab #1 – #8" },
  { section: "Tabs", keys: "⌘9", action: "Go to last tab" },
  { section: "Tabs", keys: "", action: "Toggle pin on current tab" },
  { section: "Tabs", keys: "⌘\\", action: "Split right" },
  { section: "Tabs", keys: "＋ button", action: "New tab" },

  // ── Files ─────────────────────────────────────────────────────────────────
  { section: "Files", keys: "⌘N", action: "Create new note" },
  { section: "Files", keys: "", action: "Delete current note" },
  { section: "Files", keys: "Double-click title", action: "Rename current note" },
  { section: "Files", keys: "", action: "Insert template" },
  { section: "Files", keys: "", action: "Open today's daily note" },
  { section: "Files", keys: "", action: "Version history" },

  // ── Editor ────────────────────────────────────────────────────────────────
  { section: "Editor", keys: "⌘E", action: "Toggle reading view" },
  { section: "Editor", keys: "", action: "Editor: Live Preview" },
  { section: "Editor", keys: "", action: "Editor: Source mode" },
  { section: "Editor", keys: "", action: "Editor: Reading view" },
  { section: "Editor", keys: "⌘B", action: "Toggle bold" },
  { section: "Editor", keys: "⌘I", action: "Toggle italic" },
  { section: "Editor", keys: "⌘K", action: "Insert markdown link" },
  { section: "Editor", keys: "⌘⇧H", action: "Toggle highlight" },
  { section: "Editor", keys: "[[", action: "Wikilink autocomplete" },
  { section: "Editor", keys: "#", action: "Tag autocomplete" },
  { section: "Editor", keys: "", action: "Toggle line numbers" },
  { section: "Editor", keys: "", action: "Toggle spellcheck" },
  { section: "Editor", keys: "", action: "Toggle readable line length" },

  // ── Panels ────────────────────────────────────────────────────────────────
  { section: "Panels", keys: "", action: "Toggle left sidebar" },
  { section: "Panels", keys: "", action: "Toggle right sidebar" },
  { section: "Panels", keys: "", action: "Show file explorer" },
  { section: "Panels", keys: "", action: "Show bookmarks" },

  // ── Vault ─────────────────────────────────────────────────────────────────
  { section: "Vault", keys: "⌘,", action: "Open settings" },
  { section: "Vault", keys: "", action: "Export vault as zip" },
  { section: "Vault", keys: "", action: "Import notes from zip" },
  { section: "Vault", keys: "", action: "Switch vault" },
  { section: "Vault", keys: "", action: "Log out" },

  // ── Quick switcher ────────────────────────────────────────────────────────
  { section: "Quick switcher", keys: "↵", action: "Open the highlighted note" },
  { section: "Quick switcher", keys: "⇧↵", action: "Create a note with the typed name" },
  { section: "Quick switcher", keys: "⌘↵", action: "Open in a background tab" },

  // ── Canvas ────────────────────────────────────────────────────────────────
  { section: "Canvas", keys: "Double-click", action: "Create a card" },
  { section: "Canvas", keys: "⌫ / Delete", action: "Delete the selected card or edge" },
  { section: "Canvas", keys: "Esc", action: "Finish editing a card" },
];

/** Distinct section names, in first-seen order (for grouped rendering). */
export const HOTKEY_SECTIONS: string[] = [...new Set(HOTKEYS.map((h) => h.section))];

export function filterHotkeys(query: string): HotkeyEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return HOTKEYS;
  return HOTKEYS.filter(
    (h) =>
      h.action.toLowerCase().includes(q) ||
      h.keys.toLowerCase().includes(q) ||
      h.section.toLowerCase().includes(q),
  );
}
