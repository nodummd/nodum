---
title: Import and export
section: Organising
order: 4
summary: Import from Obsidian, Notion, Evernote, Google Keep, Slack and a dozen more; take the whole vault out as a zip of markdown files at any time.
where: Settings → Vault → Import data · Command palette → Import data from another app…
---

## Importing

**Settings → Vault → Import data** opens the picker — twenty sources, grouped
into notes, chat and email. Pick the one you are coming from and it tells you
how to produce the export before asking for a file, because getting the export
out of the *other* app is the step people are actually missing.

Whatever the source, the result is the same: plain markdown notes in folders
that mirror the original structure, with `[[wikilinks]]` resolved across
everything imported at once and colliding names suffixed rather than
overwritten.

### Notes and knowledge

- **Obsidian** — zip the vault, or drag the folder straight in. It works as-is:
  the wrapper folder is stripped, `.obsidian` settings for daily notes and the
  attachment folder are read, and images and PDFs become attachments (a PDF
  also becomes a searchable note of its text).
- **Notion** — export as *Markdown & CSV* with subpages included. The
  32-character page ids Notion appends to every filename are stripped, and
  links between pages are rewritten to `[[wikilinks]]` so backlinks and the
  graph work immediately. Databases arrive as markdown tables plus the
  individual row notes.
- **Evernote** — export a notebook as `.enex`. Notebooks become folders, tags
  and source URLs become properties, and embedded images are resolved back out
  of the file and attached.
- **Google Keep** — export from Google Takeout. Checklists keep their ticked
  state, labels become tags, and archived and trashed notes land in their own
  folders.
- **Apple Notes, Logseq, Bear, Trilium, Anytype** — any markdown or TextBundle
  export. Logseq journals are renamed from `2024_01_15` to a real date.
- **Roam Research** — JSON export. `[[links]]` and `#tags` already match, so
  the graph fills in on import; block references become the text they pointed
  at.
- **Joplin** — a `.jex` export, with the notebook tree rebuilt from its ids.
- **Standard Notes** — a *decrypted* backup; an encrypted one cannot be read by
  anything but Standard Notes, and the importer says so rather than reporting
  an empty success.
- **Markdown files** — any folder of `.md`, `.txt` or `.html` from anywhere.

### Chat

**Slack**, **Discord** and **Telegram** exports become one note per channel per
day, with an index note per channel and one for the workspace — so the graph
gets a shape instead of several thousand orphans.

### Email

**Gmail** (a Takeout `.mbox`), **Outlook** and any `.eml` or `.mbox` become one
note per message, foldered by Gmail label where there is one. Quoted reply
chains are trimmed; attachments are listed by name rather than imported.

### Why exports rather than "connect your account"

For most of these there is no other honest option. Google's Keep API is
Workspace-only and cannot be authorised by a personal account at all. Gmail's
scopes require an annual third-party security audit costing five figures.
Slack limits new apps to one history request per minute. Telegram's Bot API
cannot read your own history, and scripting a Discord user account is a
bannable offence. Evernote's API was withdrawn. An export gives you the same
data in minutes, for nothing.

Notion, OneNote and Outlook do have usable APIs, and a live connection for
those is possible — it needs an app registered for the instance you are using.

## Exporting

**Export vault** downloads a zip of every note as `<path>.md`, folders preserved. It is your notes, as plain files; nothing is proprietary.

## Attachments

Paste or drag an image or PDF into a note and it uploads and embeds at the cursor as `![[name.png]]`. Images show inline; hovering an embed previews it. Files are capped at 5 MB, and only common image and document types are accepted.
