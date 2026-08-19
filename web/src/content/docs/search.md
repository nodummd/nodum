---
title: Search and the quick switcher
section: Finding things
order: 1
summary: The quick switcher opens a note by name in two keystrokes; search finds text inside notes with operators for path, file and tag.
where: Ribbon → magnifier (⌘O). Search: left sidebar → second tab
---

## Quick switcher — `⌘O`

Type a few letters of a name; the best matches appear as you type. `Enter` opens the top one, `⌘Enter` opens it in a background tab, `⇧Enter` creates a new note with the name you typed. It forgives typos and matches on aliases too.

![The quick switcher after typing three letters.](/docs/switcher.png)

## Search — the left sidebar's second tab

Full-text search across every note, ranked, with the matching passage shown under each result. Sort by relevance, modified, created or title.

![Search results for a word.](/docs/search.png)

Operators narrow it:

| Operator | Finds |
| --- | --- |
| `path:Projects` | notes whose path starts with `Projects` |
| `file:Weekly` | notes whose name contains `Weekly` |
| `tag:#book` | notes tagged `#book` (nested tags match) |
| `"exact phrase"` | that phrase |

They combine: `tag:#book path:Books stoicism`.

## From the editor

Select a word in a note, right-click → *Search for “…”* — the sidebar opens with that search run.

## Related notes

The Backlinks panel ends with *Related notes*: notes that are about similar things, found by meaning rather than by shared words. Useful for finding the note you forgot to link.
