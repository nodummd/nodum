"""Markdown, text, HTML and TextBundle — the shape most exports already have.

This one converter serves Obsidian, Logseq, Bear, Apple Notes, iA Writer,
Zettlr, generic markdown folders and generic HTML, because all of them export
"a folder of files with a structure worth keeping". The differences between
them are small enough to handle inline:

- **Logseq** puts pages in `pages/` and dated entries in `journals/`, named
  `2024_01_15.md`. Those become `2024-01-15` so they read as dates.
- **Bear** exports `.textbundle` directories — `text.md` plus `assets/` — which
  are unwrapped so the note keeps the bundle's name.
- **Apple Notes** has no native export; people use the Exporter app or export
  HTML, and both land here.
- **Obsidian** needs nothing at all: its vault *is* this format.

Attachments pass through untouched for the import pipeline to store.
"""

from __future__ import annotations

import posixpath
import re
from typing import Any

from .archives import decode, iter_files
from .base import ConvertResult, ImportError_, UploadedFile, frontmatter, safe_segment, unique_path
from .html_md import html_to_markdown

_TEXT_EXTS = (".md", ".markdown", ".txt", ".text", ".mdx")
_HTML_EXTS = (".html", ".htm")
#: Logseq journal filenames: 2024_01_15.md
_LOGSEQ_JOURNAL = re.compile(r"^(\d{4})[_-](\d{2})[_-](\d{2})$")


def _normalise_segments(path: str) -> list[str]:
    """Clean a path, unwrapping TextBundles and tidying Logseq journals."""
    segments: list[str] = []
    for part in path.split("/"):
        if not part.strip():
            continue
        # "Note.textbundle/text.md" → "Note.md": keep the bundle's name.
        if part.lower().endswith(".textbundle"):
            segments.append(safe_segment(part[: -len(".textbundle")]))
            continue
        if part.lower().endswith(".textpack"):
            segments.append(safe_segment(part[: -len(".textpack")]))
            continue
        segments.append(safe_segment(part))
    return segments


def _is_bundle_body(path: str) -> bool:
    parent = posixpath.basename(posixpath.dirname(path)).lower()
    return parent.endswith((".textbundle", ".textpack")) and posixpath.basename(path).lower() in (
        "text.md",
        "text.markdown",
        "text.txt",
    )


def convert(uploads: list[UploadedFile], *, source: str = "import") -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()
    saw_anything = False

    for name, data in iter_files(uploads):
        saw_anything = True
        lower = name.lower()
        ext = posixpath.splitext(lower)[1]

        # Logseq and Obsidian both ship config directories that are not notes.
        if any(part in name.split("/") for part in (".obsidian", ".trash", "logseq", ".git")) and ext not in _TEXT_EXTS:
            continue

        if ext in _TEXT_EXTS or _is_bundle_body(name):
            segments = _normalise_segments(name)
            if _is_bundle_body(name):
                # The bundle directory already became the note's name.
                segments = segments[:-1]
            if not segments:
                continue
            stem = posixpath.splitext(segments[-1])[0]

            # Logseq journals: 2024_01_15 → 2024-01-15, and out of "journals/".
            journal = _LOGSEQ_JOURNAL.match(stem)
            if journal and len(segments) >= 2 and segments[-2].lower() == "journals":
                stem = "-".join(journal.groups())
                segments = [*segments[:-2], "Journals", stem]
            elif len(segments) >= 2 and segments[-2].lower() == "pages":
                # Logseq's flat "pages/" folder adds nothing once imported.
                segments = [*segments[:-2], stem]
            else:
                segments = [*segments[:-1], stem]

            path = unique_path(taken, "/".join(segments) + ".md")
            result.add(path, decode(data))
            continue

        if ext in _HTML_EXTS:
            segments = _normalise_segments(name)
            stem = posixpath.splitext(segments[-1])[0] if segments else "Untitled"
            body = html_to_markdown(decode(data))
            if not body.strip():
                continue
            meta: dict[str, Any] = {"source": source}
            path = unique_path(taken, "/".join([*segments[:-1], stem]) + ".md")
            heading = "" if body.lstrip().startswith("#") else f"# {stem}\n\n"
            result.add(path, frontmatter(meta) + heading + body + "\n")
            continue

        # Everything else is a binary the import pipeline may store as an
        # attachment; it decides what is allowed, not this converter.
        path = unique_path(taken, "/".join(_normalise_segments(name)))
        if path:
            result.add_binary(path, data)

    if not saw_anything:
        raise ImportError_("That upload was empty.")
    if result.note_count == 0:
        raise ImportError_("No notes found — the upload had no .md, .txt or .html files in it.")
    return result
