# Nodum Web Clipper

Clips web pages into a nodum vault as clean Markdown. Manifest V3.

## Install (unpacked)

1. In nodum: **Settings → Web Clipper → Generate token**, copy it.
2. Chrome/Edge → `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select this `clipper/` folder.
3. Click the extension, paste your server URL (default `http://localhost:8000`)
   and the token, then **Connect**.

## How it works

- The popup injects `extractPage()` into the active tab, picks the best article
  container, and converts it to Markdown in the page's own world.
- A text selection wins over the whole article when one exists.
- `POST /api/v1/clipper/clip` with an `X-Nodum-Token` header creates the note.
  The token can only create notes and is stored hashed server-side — it is not
  a session, so it cannot read or delete anything.
- Right-click a selection for a one-click clip without opening the popup.

## Why not fork obsidian-clipper?

Obsidian's clipper is MIT and worth learning from, but it saves through the
`obsidian://` protocol into a local vault. nodum is server-backed, so the save
path is an authenticated HTTP call instead — which also means clipping works on
a machine that has no nodum app installed. Its extraction library
(`defuddle`, MIT) is the natural upgrade if this extractor proves too naive.
