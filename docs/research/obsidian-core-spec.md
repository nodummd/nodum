# Obsidian Core Feature Parity Spec

> Research compiled 2026-08-12 from the official Obsidian Help (help.obsidian.md → obsidian.md/help),
> the obsidianmd docs repo, and Obsidian's default theme CSS. This is the behavioral contract our
> clone implements. Sections marked **[default-theme]** come from Obsidian's `app.css` (widely
> documented community knowledge, not restated verbatim in the help docs).

---

## 1. Editor modes

Obsidian separates **views** (editing vs. reading) from **editing modes** (how markdown is displayed while editing).

### 1.1 Reading view
- Renders the note fully — no markdown syntax visible; a clean, formatted, mostly-read-only render.
- Interactive elements still work: checkboxes toggle, links navigate, callouts fold, embeds render.
- Toggle with `Ctrl/Cmd+E` ("Toggle Reading view" command), the view-switcher icon in the tab header (top-right), or the status bar indicator.
- Default view for new tabs configurable: **Settings → Editor → Default view for new tabs** (Editing / Reading).

### 1.2 Editing view — Live Preview (default editing mode)
The defining behavior — implement exactly:
- Markdown **syntax characters are hidden** and the formatted result is rendered **in place**, per-line/per-span, EXCEPT where the cursor or an active selection touches the formatted range: then the raw syntax reappears for that range so it can be edited. Moving the cursor off the line hides the syntax again.
  - `**bold**` renders as **bold**; placing the caret inside it reveals the asterisks.
  - Heading `#` marks hide when the cursor leaves the heading line.
  - `[[Wikilinks]]` display as styled links (alias text only if `|alias`); the brackets/target reappear when the cursor enters the link.
- **Widgets render inline** in the editor document flow:
  - Image/file/note embeds (`![[...]]`) render in place.
  - Task checkboxes are real, clickable checkboxes.
  - Callouts render as callout boxes (raw `>` blockquote syntax shown when the cursor is inside).
  - Tables render as interactive table widgets (Obsidian 1.5+ table editor).
  - Code blocks render with syntax highlighting; the fence backticks show when the cursor is inside the block.
  - `%%comments%%` are visible in editing views only, never in Reading view.
- Links: plain click places the cursor; `Ctrl/Cmd+click` follows the link; `Ctrl/Cmd+Alt+click`-style modifiers or `Ctrl/Cmd+Enter` variants open in a new tab. Hover + `Ctrl/Cmd` shows the page-preview popover.
- Properties (frontmatter) render as the Properties UI widget at the top of the note instead of raw YAML.

### 1.3 Editing view — Source mode
- Shows **all** markdown syntax as plain text, exactly as written on disk. No hiding, no widgets (frontmatter shown as raw YAML). Syntax highlighting still applied.
- Switch via the tab-header "more options"/view switcher, the status bar mode indicator, or the command **"Toggle Live Preview/Source mode"** (no default hotkey).
- Default editing mode configurable: **Settings → Editor → Default editing mode** (Live Preview / Source mode).

---

## 2. Wikilinks & link semantics

### 2.1 Syntax forms
| Form | Meaning |
|---|---|
| `[[Note name]]` | Link to note by name (extension `.md` optional) |
| `[[Projects/Note name]]` | Link by path (always forward slashes, all platforms) |
| `[[Note name\|Display text]]` | Link with custom display text (alias) |
| `[[#Heading]]` | Heading in the *same* note |
| `[[Note#Heading]]` | Heading in another note |
| `[[Note#H1#H2#H3]]` | Nested heading path — successive `#` segments descend the heading hierarchy |
| `[[Note#^block-id]]` | Block reference |
| `[[#^block-id]]` | Block in the same note |
| `![[...]]` | Embed (any of the above forms, `!` prefix) |
| `[Text](Note%20name.md)` | Markdown-style equivalent; spaces/special chars must be URL-encoded |
| `[[Figure 1.png]]` | Non-markdown files require the file extension |

- Wikilink and markdown link formats are functionally equivalent; a vault-wide setting (**Settings → Files and links → Use [[Wikilinks]]**) controls which format Obsidian *generates*.
- Typing `[[` opens link autocomplete. `[[## query]]` searches headings across the whole vault; `[[^^ query]]` searches blocks across the whole vault.
- Characters that break a link target: `# | ^ : %% [[ ]]` — a target string containing these may not work as a link. `|` inside a wikilink must be escaped as `\|` inside tables.

### 2.2 Block identifiers
- Auto-generated (e.g. `^b15695`) or user-typed. Allowed characters: **Latin letters, numbers, and dashes only**.
- Placement: end of a paragraph line (` ^id` after a space); for list items directly on the bullet line; for multi-line structured blocks (lists, quotes, callouts, tables) the `^id` goes on its **own line**, with blank lines before and after.
- No support for linking to sub-parts *inside* quotes, callouts, or tables.

### 2.3 Link resolution rules
Setting **Settings → Files and links → New link format** controls what gets *written* when a link is created:
1. **Shortest path when possible** (default): just the filename if it is unique in the vault; otherwise enough path to disambiguate (falls back to full vault path).
2. **Relative path to file**: path relative to the containing note's folder (`../Other/Note.md` style).
3. **Absolute path in vault**: full path from the vault root (no leading slash).

Resolution (reading side) accepts all three: a bare name resolves vault-wide against filenames and aliases; if multiple files share a name, path-qualified links disambiguate. Resolution is case-insensitive on filenames. Links auto-update when files are renamed/moved (**Settings → Files and links → Automatically update internal links**).

### 2.4 Unresolved links
- A `[[link]]` whose target doesn't exist is an **unresolved link**: rendered visually faded/dimmed (lower opacity) vs. resolved links.
- Clicking it **creates the note** and opens it. Creation location follows **Settings → Files and links → Default location for new notes** (vault root / same folder as current file / specified folder).
- Unresolved links show in the Graph (ghost nodes) and count in "Unlinked mentions"/outgoing links.

### 2.5 Embeds (transclusion)
- `![[Note]]` embeds a whole note (rendered, with an "open" affordance); `![[Note#Heading]]` embeds only that heading's section; `![[Note#^block-id]]` embeds just that block.
- Images: `![[img.jpg]]`; resize `![[img.jpg|640x480]]` (w×h) or `![[img.jpg|100]]` (width only, aspect preserved). External images: `![alt|640x480](url)` / `![250](url)`.
- PDFs: `![[Doc.pdf]]`, `![[Doc.pdf#page=3]]`, `![[Doc.pdf#height=400]]`.
- Audio: `![[clip.ogg]]` renders an audio player. Canvas: `![[My canvas.canvas]]`.
- Embedded search results via a code block with language `query` (renders live search results; not supported on Publish).

---

## 3. Callouts

### 3.1 Syntax
```md
> [!info]
> Body text — supports **markdown**, [[wikilinks]], and embeds.
```
- First line of a blockquote: `> [!TYPE]` — type identifier is **case-insensitive**.
- Optional custom title on the same line: `> [!tip] My Title` (title itself supports inline markdown).
- **Default title** = the type identifier in Title Case (e.g. `[!tip]` → "Tip").
- **Title-only callout**: omit the body entirely.
- **Foldable**: `> [!faq]-` collapsed by default; `> [!faq]+` expanded by default (both render a fold chevron).
- **Nesting**: callouts nest inside callouts with additional `>` levels (`> > [!note]`), arbitrary depth.
- Unknown types fall back to the default (`note`) appearance, but keep `data-callout="<type>"` so CSS can restyle them.
- Custom types via CSS: `.callout[data-callout="x"] { --callout-color: R, G, B; --callout-icon: lucide-icon-id; }` (`--callout-color` is an RGB tuple; `--callout-icon` is a Lucide ID or inline SVG).

### 3.2 Full type table (13 types + aliases; icons/colors **[default-theme]**)
Background = `rgba(color, 0.1)`; title text/icon = `rgb(color)`.

| Type | Aliases | Lucide icon | Color | RGB |
|---|---|---|---|---|
| `note` | — | `lucide-pencil` | blue | `8, 109, 221` |
| `abstract` | `summary`, `tldr` | `lucide-clipboard-list` | cyan | `0, 191, 188` |
| `info` | — | `lucide-info` | blue | `8, 109, 221` |
| `todo` | — | `lucide-check-circle-2` | blue | `8, 109, 221` |
| `tip` | `hint`, `important` | `lucide-flame` | cyan | `0, 191, 188` |
| `success` | `check`, `done` | `lucide-check` | green | `8, 185, 78` |
| `question` | `help`, `faq` | `lucide-help-circle` | yellow | `224, 172, 0` |
| `warning` | `caution`, `attention` | `lucide-alert-triangle` | orange | `236, 117, 0` |
| `failure` | `fail`, `missing` | `lucide-x` | red | `233, 49, 71` |
| `danger` | `error` | `lucide-zap` | red | `233, 49, 71` |
| `bug` | — | `lucide-bug` | red | `233, 49, 71` |
| `example` | — | `lucide-list` | purple | `120, 82, 238` |
| `quote` | `cite` | `lucide-quote` | grey | `158, 158, 158` |

---

## 4. Frontmatter / Properties

### 4.1 Format
- YAML between `---` delimiters, **first line of the file only**.
- `name: value`, colon + space required; names unique per note; order irrelevant.
- JSON frontmatter (`---` + JSON object + `---`) is accepted on read but re-saved as YAML.
- In Live Preview, frontmatter renders as the **Properties editor UI**; Source mode shows raw YAML.
- Display setting: **Settings → Editor → Properties in document** = Visible (default) / Hidden / Source.
- Invalid YAML marks the whole block as invalid (shown with an error state); markdown inside values is never rendered; hashtags inside text property values are NOT tags.

### 4.2 Property types (assigned **per property name, vault-wide**)
| Type | Rules |
|---|---|
| **Text** | Single line; no markdown rendering; internal links allowed but must be quoted: `link: "[[Note]]"` |
| **List** | YAML sequence (`- item` lines); items are text/links (quoted); `tags`, `aliases`, `cssclasses` are lists |
| **Number** | Literal integers/floats only, no expressions |
| **Checkbox** | `true`/`false`; empty value = indeterminate state; interactive checkbox in UI |
| **Date** | `YYYY-MM-DD`; displayed per OS locale; acts as a link to the daily note when Daily Notes is enabled |
| **Date & time** | `YYYY-MM-DDTHH:MM:SS` |

Type is changed via the type icon next to the property name (or the Properties view). Nested/object properties are NOT supported (view in source mode only).

### 4.3 Special keys
- `tags` (List — dedicated tags type: values become clickable tags, no `#` needed in YAML)
- `aliases` (List — alternative names; Quick Switcher and `[[` autocomplete match aliases)
- `cssclasses` (List — CSS classes applied to that note's container)
- Deprecated singular forms removed in v1.9: `tag`, `alias`, `cssclass`.
- Publish-only keys: `publish`, `permalink`, `description`, `image`, `cover`.

### 4.4 Properties UI interactions
- Add property: `Cmd/Ctrl+;`, command "Add file property", or file menu.
- Navigate fields: arrows / Tab / Shift+Tab; jump to body: `Alt+Down`; delete property: `Cmd/Ctrl+Backspace`; rename via context menu; global rename via Properties *view* (sidebar plugin).
- Templates: inserting a template **merges** its properties into the note's existing ones.

---

## 5. Tags

- Inline syntax: `#tag` in the note body; or via the `tags` property (no `#` in YAML).
- **Allowed characters**: letters (any language/Unicode incl. emoji/symbols), digits, `_`, `-`, `/` (nesting only). Anything else (space, punctuation) terminates the tag.
- **Must contain at least one non-numeric character**: `#1984` is not a tag; `#y1984`, `#198_4` are.
- No spaces — conventions: camelCase, PascalCase, snake_case, kebab-case.
- **Case-insensitive** for matching (`#Tag` ≡ `#tag`); display preserves first-used casing; treat as one tag.
- **Nested tags**: `#inbox/to-read` — `/` builds a hierarchy; Tags view renders it as a tree; searching/clicking a parent (`tag:#inbox`) matches all descendants (`#inbox/to-read`), but a child segment alone (`tag:read`) does not match `#inbox/to-read` — matching is prefix-path based.
- Tags are recognized in the note **body** and in the `tags` frontmatter property only (not in code blocks; not in other property values).
- Clicking a tag opens search for it. Tags view (core plugin) lists all tags with counts; `#` autocomplete suggests existing tags.

---

## 6. Search (core plugin)

Open: `Ctrl/Cmd+Shift+F` (vault-wide; sidebar). In-note find: `Ctrl/Cmd+F`; replace: `Ctrl/Cmd+H`. Empty search shows recent searches. Searches note + canvas content; excluded files (Settings → Files and links → Excluded files) are filtered/deprioritized.

### 6.1 Term logic
- `foo bar` — implicit AND (both anywhere in file)
- `foo OR bar` — union (OR is uppercase)
- `-foo` — exclusion; `-(foo bar)` excludes files matching both
- `"exact phrase"` — quoted phrase match; escape inner quotes `\"`
- `( )` — grouping/precedence, nestable
- `/regex/` — JavaScript-flavored regex between slashes, combinable with operators
- Case-insensitive by default; **Match case** toggle in the search bar; or per-term `match-case:` / `ignore-case:`

### 6.2 Operators (all except match-case/ignore-case accept `(...)` sub-queries)
| Operator | Behavior |
|---|---|
| `file:` | Match filename (`file:.jpg`, `file:202209`) |
| `path:` | Match full vault path (`path:"Daily notes/2022-07"`) |
| `content:` | Match file content explicitly |
| `tag:` | Match tag (`tag:#work` or `tag:work`); parent matches nested children; faster than full-text |
| `line:(...)` | All terms on the **same line** |
| `block:(...)` | All terms in the same markdown block (slower — parses markdown) |
| `section:(...)` | All terms in the same section (between headings) |
| `task:` | Terms within any task item |
| `task-todo:` | Only unchecked tasks |
| `task-done:` | Only checked tasks |
| `match-case:` / `ignore-case:` | Per-term case sensitivity |
| `[property]` | File has the property |
| `[property:value]` | Property equals/contains value; supports OR + regex inside |
| `[property:null]` | Property present with no value |

### 6.3 Results UI
- Sort: File name A→Z (default) / Z→A, Modified new↔old, Created new↔old.
- Toggles: Explain search term, Collapse results, Show more context.
- Copy search results (three-dot menu); bookmarkable searches; embeddable in notes via ```` ```query ```` blocks.

---

## 7. Quick Switcher & Command Palette

### 7.1 Quick Switcher (`Ctrl/Cmd+O`)
- Fuzzy-matches note **names and aliases** (aliases marked in results); shows path for disambiguation.
- Empty query → recent files list; `Down`+`Enter` flips between the two most recent notes.
- `Enter` opens selection; if no match, `Enter` **creates** a note with the typed name; `Shift+Enter` force-creates with exact typed name even when matches exist; `Ctrl/Cmd+Enter` opens in a new tab.
- Settings: **Show all file types**, **Show attachments**, **Show existing files only** (when off, unresolved link names appear as creatable entries).
- Vaults ≥10,000 items switch to a simpler match algorithm; excluded files are deprioritized.

### 7.2 Command Palette (`Ctrl/Cmd+P`)
- Fuzzy search across all commands (abbreviation matching: "scf" → **S**ave **c**urrent **f**ile). Recently used commands float to the top (v1.8.3+), with shorter names prioritized during filtering.
- Shows each command's hotkey on the right; arrow keys + Enter to run.
- **Pinned commands** (Settings → Command palette) always appear at the top.

---

## 8. Daily Notes & Templates

### 8.1 Daily Notes (core plugin)
- "Opens today's note, creating it if missing." Triggers: ribbon calendar icon, command **"Open today's daily note"**, optional hotkey.
- Settings: **Date format** (moment.js tokens; default `YYYY-MM-DD`; may include `/` to create folders, e.g. `YYYY/MMMM/YYYY-MMM-DD` → `2023/January/2023-Jan-01`), **New file location**, **Template file location**, **Open daily note on startup**.
- Date-type properties render as links to the matching daily note when the plugin is on.

### 8.2 Templates (core plugin)
- **Template folder location** must be set; templates are ordinary notes in that folder.
- Insert: ribbon **Insert template**, command `Templates: Insert template`, or hotkey; content inserts at cursor. Also: `Templates: Insert current date` / `Insert current time`.
- Variables replaced on insert:
  - `{{title}}` — active note's name
  - `{{date}}` — today, default format `YYYY-MM-DD`
  - `{{time}}` — now, default format `HH:mm`
  - `{{date:FORMAT}}` / `{{time:FORMAT}}` — explicit **moment.js** format tokens (e.g. `{{date:dddd, MMMM Do YYYY}}`)
  - Defaults configurable via plugin's **Date format** / **Time format** settings.
- No date arithmetic/offsets in core (`{{date+1d}}` is Templater/community territory).
- Daily-note creation from a template also substitutes `{{date}}`/`{{time}}`; properties from templates merge into existing frontmatter.
- Moment tokens to support at minimum: `YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s A a Do X`.

---

## 9. Bookmarks, Outline, Word count

### 9.1 Bookmarks (core plugin)
- Bookmarkable: **files, folders, searches, graphs (global only), headings, blocks, links (Web Viewer)**.
- Create via: "Bookmark the active tab" button, right-click in File Explorer (file/folder), search three-dot menu → Bookmark, right-click a heading / "Bookmark heading under cursor", "Bookmark block under cursor", multi-select (Alt/Shift click) → Bookmark, or bookmark all tabs in a group.
- Creating opens a dialog with an optional **custom title**.
- **Groups**: "New bookmark group", nestable organization; drag-and-drop to reorder/move; expand/collapse; right-click to rename/edit/delete.
- View: left-sidebar Bookmarks icon or command "Bookmarks: Show bookmarks".

### 9.2 Outline (core plugin)
- Sidebar view listing the active note's **headings as a nested tree** (H1–H6 hierarchy).
- Click a heading → scroll/jump to it. Drag a heading within the outline → **reorders the note's sections**. Collapsible branches; filter/search field at top ("Search headings...").

### 9.3 Word count (core plugin)
- Status bar (desktop) shows `N words` and `N characters` for the active note; mobile shows it atop the right sidebar.
- With an active **selection**, counts reflect the selection instead of the whole note.
- CJK-aware word segmentation (no space-delimited words in CJK).

---

## 10. Default hotkeys (Windows/Linux → macOS)

### App
| Command | Win/Linux | macOS |
|---|---|---|
| New note | `Ctrl+N` | `Cmd+N` |
| Quick switcher | `Ctrl+O` | `Cmd+O` |
| Command palette | `Ctrl+P` | `Cmd+P` |
| Search current file | `Ctrl+F` | `Cmd+F` |
| Search & replace | `Ctrl+H` | `Cmd+H` |
| Search all files | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| Toggle Reading view | `Ctrl+E` | `Cmd+E` |
| Open settings | `Ctrl+,` | `Cmd+,` |
| Open graph view | `Ctrl+G` | `Cmd+G` |
| Navigate back / forward | `Ctrl+Alt+←` / `→` | `Cmd+Alt+←` / `→` |
| Save file | `Ctrl+S` | `Cmd+S` |
| New tab | `Ctrl+T` | `Cmd+T` |
| Close tab | `Ctrl+W` | `Cmd+W` |
| Follow link under cursor | `Alt+Enter` | `Alt+Enter` |
| Open link in new tab | `Ctrl+Click` | `Cmd+Click` |

### Editing / formatting
| Command | Win/Linux | macOS |
|---|---|---|
| Bold | `Ctrl+B` | `Cmd+B` |
| Italic | `Ctrl+I` | `Cmd+I` |
| Insert markdown link | `Ctrl+K` | `Cmd+K` |
| Toggle checkbox status | `Ctrl+Enter` | `Cmd+Enter` |
| Add file property | `Ctrl+;` | `Cmd+;` |
| Indent / Unindent (lists) | `Tab` / `Shift+Tab` (also `Ctrl+]` / `Ctrl+[`) | same / `Cmd+]` `Cmd+[` |
| Delete paragraph | `Ctrl+D` | `Cmd+D` |
| Delete current line | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| Paste without formatting | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | `Cmd+Z` / `Cmd+Shift+Z` |
| Delete previous / next word | `Ctrl+Backspace` / `Ctrl+Delete` | `Alt+Backspace` / `Alt+Delete` |
| Line start / end | `Home` / `End` | `Cmd+←` / `Cmd+→` |
| Note start / end | `Ctrl+Home` / `Ctrl+End` | `Cmd+↑` / `Cmd+↓` |
| Multiple cursors | `Alt+Click` | `Alt+Click` |

Commands with **no default hotkey** (bindable): Toggle Live Preview/Source mode, Toggle bullet/numbered list, Insert template, Open today's daily note, Toggle left/right sidebar, Fold more/less, Move line up/down. Hotkeys are fully remappable in **Settings → Hotkeys** (searchable; multiple bindings per command; conflict highlighting; filter by assigned).

---

## Appendix A — Obsidian-flavored markdown extras (needed by the above)
- Highlight `==text==`; strikethrough `~~text~~`; comments `%%hidden in reading view%%` (multi-line capable).
- Tasks: `- [ ]` / `- [x]` (any character in brackets counts as "done" for rendering, `x` canonical).
- Line breaks: default markdown rules; **Strict line breaks** setting makes single newlines NOT break lines.
- Escaping with `\` for `* _ # \` \| ~` etc.
- Footnotes `[^1]`, math `$inline$` / `$$block$$`, mermaid code blocks, ` ```query ``` ` embedded searches.

## Appendix B — Default theme accent RGBs **[default-theme]**
red `233,49,71` · orange `236,117,0` · yellow `224,172,0` · green `8,185,78` · cyan `0,191,188` · blue `8,109,221` · purple `120,82,238` · pink `213,57,132`

## Sources
- https://obsidian.md/help/edit-and-read · /links · /embeds · /callouts · /properties · /tags · /syntax · /editing-shortcuts · /hotkeys
- https://obsidian.md/help/plugins/search · /quick-switcher · /command-palette · /daily-notes · /templates · /bookmarks · /outline · /word-count
- obsidianmd docs repo (raw markdown), Obsidian Forum (link format), community references for default callout icon/color mappings (usethekeyboard.com, got.md, retypeapp mirror).
