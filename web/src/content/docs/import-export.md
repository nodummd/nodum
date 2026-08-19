---
title: Import and export
section: Organising
order: 4
summary: Bring in a folder of markdown, an Obsidian vault or a zip; take the whole vault out as a zip of markdown files at any time.
where: Command palette → Import notes from a zip / Import a folder / Export vault
---

## Importing

From the command palette:

- **Import notes from a zip** — a zip of `.md` files, in folders. An **Obsidian vault** zipped whole works as-is: the wrapper folder is stripped, `.obsidian` settings for daily notes and the attachment folder are read, images and PDFs become attachments (a PDF also becomes a searchable note of its text), and `[[wikilinks]]` resolve across everything imported.
- **Import a folder** — pick a folder from your computer; same handling, no zip needed.

Names that collide get a suffix rather than overwriting.

## Exporting

**Export vault** downloads a zip of every note as `<path>.md`, folders preserved. It is your notes, as plain files; nothing is proprietary.

## Attachments

Paste or drag an image or PDF into a note and it uploads and embeds at the cursor as `![[name.png]]`. Images show inline; hovering an embed previews it. Files are capped at 5 MB, and only common image and document types are accepted.
