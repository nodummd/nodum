---
title: Links and backlinks
section: Links & graph
order: 1
summary: Wikilinks connect notes; backlinks show who links to the note you are reading; unresolved links create notes when clicked.
where: Type [[ in any note; the Backlinks panel is the first icon in the right sidebar
---

## Making a link

Type `[[` and a note's name. A list appears as you type — press `Enter` or click to complete it. In live preview the link shows as just the note's name; move the cursor into it to see and edit the target.

![The completion list that appears as you type a link.](/docs/wikilink-autocomplete.png)

Variants:

- `[[Note|shown text]]` — an alias: shows *shown text*, links to *Note*.
- `[[Note#Heading]]` — jumps to a heading inside the note.
- `[[Folder/Note]]` — a full path, when two notes share a name. In live preview only the note's name shows.
- `![[Note]]` — an embed: shows the other note's content inside this one. `![[image.png]]` embeds an image.

## Following a link

Click a link to open the note **in the same tab** — the back and forward arrows next to the breadcrumb bring you back. `⌘`-click opens a new tab. Hold `⌘` while hovering (or plain hover, depending on Settings → Editor) for a preview card.

## Links to notes that don't exist

A link to a name with no note behind it is an *unresolved* link — dimmer, and a ghost node in the graph. Click it and the note is created and opened. That is how you write ahead of yourself: link to the idea now, fill it in later.

## Backlinks

Open the first panel in the right sidebar. It lists every note that links to the one you are reading, with the sentence around each link. Below it, *unlinked mentions* are places that use this note's name without linking — one click turns each into a link.

![The Backlinks panel for a note.](/docs/backlinks.png)

There is also **Backlinks in document** (the note's ⋯ menu), which pins the same list under the note itself.

## Outgoing links

The second panel is the reverse: every link *from* this note, resolved or not.

## Renaming and links

Rename a note and every link to it keeps working: links are matched by name, and the app updates the ones it can. Links to the old name that could not be updated show as unresolved so you can see them.
