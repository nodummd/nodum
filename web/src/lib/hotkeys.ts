/** Every nodum shortcut, for the Hotkeys reference tab (S12.1). */

export interface HotkeyEntry {
  section: string;
  keys: string;
  action: string;
}

export const HOTKEYS: HotkeyEntry[] = [
  // Workspace
  { section: "Workspace", keys: "⌘O", action: "Open quick switcher" },
  { section: "Workspace", keys: "⌘N", action: "Create new note" },
  { section: "Workspace", keys: "⌘G", action: "Open graph view" },
  { section: "Workspace", keys: "⌘P", action: "Open command palette" },
  { section: "Workspace", keys: "⌘,", action: "Open settings" },
  { section: "Workspace", keys: "⌘W", action: "Close current tab" },
  { section: "Workspace", keys: "⌘E", action: "Toggle reading view" },
  { section: "Workspace", keys: "⌘\\", action: "Split the editor right" },
  { section: "Workspace", keys: "⌘[", action: "Navigate back" },
  { section: "Workspace", keys: "⌘]", action: "Navigate forward" },

  // Editor
  { section: "Editor", keys: "⌘B", action: "Toggle bold" },
  { section: "Editor", keys: "⌘I", action: "Toggle italic" },
  { section: "Editor", keys: "⌘K", action: "Insert markdown link" },
  { section: "Editor", keys: "⌘⇧H", action: "Toggle highlight" },
  { section: "Editor", keys: "[[", action: "Wikilink autocomplete" },
  { section: "Editor", keys: "#", action: "Tag autocomplete" },
  { section: "Editor", keys: "⌘/Ctrl + hover", action: "Page preview of a wikilink" },

  // Quick switcher
  { section: "Quick switcher", keys: "↵", action: "Open the highlighted note" },
  { section: "Quick switcher", keys: "⇧↵", action: "Create a note with the typed name" },
  { section: "Quick switcher", keys: "⌘↵", action: "Open in a background tab" },

  // Canvas
  { section: "Canvas", keys: "Double-click", action: "Create a card" },
  { section: "Canvas", keys: "⌫ / Delete", action: "Delete the selected card or edge" },
  { section: "Canvas", keys: "Esc", action: "Finish editing a card" },
];

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
