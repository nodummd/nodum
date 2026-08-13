# Obsidian field study #2 — smoothness & settings (2026-08-13)

First-hand study of Obsidian 1.13.7 on macOS, driven over the Chrome DevTools
Protocol against a scratch vault (the user's real vault was untouched).
Artifacts (screenshots + JSON dumps) captured during the session; the durable
findings live here.

## 1. Why Obsidian's graph feels smoother — measured, not guessed

**a. The force simulation runs in a Web Worker** (`sim.js` appears as a
dedicated CDP worker target). Layout math never blocks the UI thread, so
pan/zoom/hover stay at full frame rate even mid-simulation.

**b. Data changes are incremental — the experiment.** With the graph open,
a new note (`Zeta.md`, linking Alpha and Beta) was written to the vault:

- The new node **appeared between its linked neighbors**, not at a random
  seed position.
- Every existing node stayed put except small local nudges as the layout
  made room (Gamma moved ~2px; nearest neighbors ~20-40px).
- **No viewport change** — no fit-to-view, no zoom reset.
- Deleting a node removed it with the same gentle local settling.

nodum's graph (cosmos.gl) currently tears down and re-creates the entire
simulation with fresh random positions on every data refetch, filter
change, or force tweak, then re-fits the viewport — which is exactly the
jank the study was after.

**c. Graph controls, exact values** (from the live DOM):

| Section | Control | Range | Default |
|---|---|---|---|
| Filters | Search files (query filter) | text | — |
| Filters | Tags / Attachments / Existing only / Orphans | toggles | off/off/off/on |
| Display | Arrows | toggle | off |
| Display | Text fade threshold | −3…3 | 0 |
| Display | Node size | 0.1…5× | 1 |
| Display | Link thickness | 0.1…5× | 1 |
| Display | **Animate** (timelapse button) | — | — |
| Forces | Centre force | 0…1 | ~0.52 |
| Forces | Repel force | 0…20 | 10 |
| Forces | **Link force** (spring strength, separate from distance) | 0…1 | 1 |
| Forces | Link distance | 30…500 | 250 |

nodum gaps vs. this panel: no graph search filter, no arrows toggle, no
node-size/link-thickness sliders, no link-force slider (we hardcode spring
1.1), no tags/attachments as graph nodes.

## 2. Settings taxonomy (full dump from the Settings window)

Settings opens in its **own window**; left nav has core tabs + one tab per
core plugin. Extracted structure (abridged to what matters for nodum):

- **General**: automatic updates, language, account, hardware acceleration.
- **Editor**: default view for new tabs (edit/read), default editing mode
  (live/source), inline title, **readable line length**, strict line breaks,
  properties display mode, fold heading/indent, **line numbers**,
  indentation guides, RTL, mermaid toggle, **spellcheck**, auto-pair
  brackets/markdown, smart lists, tabs vs spaces + indent width.
- **Appearance**: base colour scheme (dark/light/adapt), **accent colour**,
  themes, CSS snippets, interface/text/monospace fonts, **font size**
  (slider) + quick adjust, custom app icon, translucent window.
- **Interface**: show tab title bar, show ribbon, ribbon configuration,
  zoom level, native menus, "open settings in new window".
- **Files and links**: default file to open, always focus new tabs,
  **default location for new notes** (+folder), attachment location
  (+subfolder), new link format, auto-update internal links, wikilinks
  toggle, detect all extensions, **confirm before deleting**, deleted-files
  destination, excluded files.
- **Hotkeys**: every command rebindable, searchable (~100+ commands).
- **Core plugins**: ~25 feature toggles (Backlinks, Bases, Bookmarks,
  Canvas, Daily notes, Graph, Outline, Page preview, Properties, Publish,
  Quick switcher, Random note, Slash commands, Sync, Templates, …).
- **Per-plugin pages**: Backlinks (show at bottom of note), Daily notes
  (date format/location/template), Page preview (**require ⌘ toggle** per
  surface), Quick switcher (show existing only / attachments / all types),
  Templates (folder + date/time formats), Note composer, Command palette
  (pinned commands).

## 3. Adoption decisions for nodum (feeds Sprints 10-12)

**Graph smoothness (highest impact, the user's explicit complaint):**
1. Incremental graph engine: persistent per-vault node position map;
   diff-apply data changes; new nodes seeded at the centroid of their
   linked neighbors + jitter; never auto-fit after first render.
2. Slider/filter/group changes must not rebuild the world (update in place;
   preserve positions when a rebuild is unavoidable).
3. Panel parity: graph search filter (reuse the groups query matcher),
   arrows toggle, node-size + link-thickness sliders, link-force slider,
   Obsidian-tuned defaults.
4. (Later, if needed) worker-based simulation — cosmos.gl is GPU-driven so
   the worker matters less; measure before porting.

**Settings (structure + the high-value options):**
1. Restructure the settings modal into a vertical-tab window: General,
   Editor, Appearance, Files & links, Hotkeys (reference), Vault, Publish,
   Collab.
2. Editor tab → default view for new tabs, readable line length, line
   numbers, spellcheck, font size — all wired into CM6 for real.
3. Appearance tab → accent colour picker (drives the CSS accent variable),
   base scheme groundwork.
4. Files & links tab → default new-note location, confirm-before-delete.
5. Page preview → "require ⌘ to trigger" toggle.
6. User-level vs vault-level split: appearance/editor prefs on the user
   (users.settings JSONB, already exists); locations/formats on the vault.
