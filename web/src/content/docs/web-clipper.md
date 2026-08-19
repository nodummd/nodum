---
title: Web clipper
section: Extending
order: 1
summary: Save a page from your browser straight into a vault as a note, with the source recorded.
where: Settings → Web Clipper; the browser extension
---

## How it works

Settings → Web Clipper issues a **clipper token** — shown once. Put it in the browser extension (source in the repository under `clipper/`), and its button turns the page you are on into a note in the vault you choose, with the title, the page's text as markdown, and the URL and date in the note's frontmatter.

The token can list your vaults (so the extension can offer a picker) and create notes; it cannot read or change notes, and you can revoke it here without touching your login.

![Settings → Web Clipper.](/docs/settings-clipper.png)
