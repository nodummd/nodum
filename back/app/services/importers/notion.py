"""Notion "Markdown & CSV" export → markdown.

Two things make a raw Notion export unpleasant to live with, and this fixes
both.

**The ids.** Notion appends a 32-character hexadecimal page id to every file
and folder name, so a migrated workspace is full of notes called
"Meeting notes 1a2b3c4d5e6f7890abcdef1234567890" and every link between them
repeats those thirty-two characters. Stripping them is the single highest-value
thing an importer can do here.

**The links.** Notion writes internal links as relative markdown paths to those
same suffixed filenames. Left alone they are dead — the files no longer exist
under those names — so they are rewritten to `[[wikilinks]]`, which is what
makes the backlinks pane and the graph light up after the import instead of
staying empty.

Databases export as CSV next to a folder of the row pages. The CSV becomes a
markdown table so the view is not lost, and the row pages import normally.
"""

from __future__ import annotations

import csv
import io
import posixpath
import re
from urllib.parse import unquote

from .archives import decode, iter_files
from .base import (
    ConvertResult,
    ImportError_,
    UploadedFile,
    frontmatter,
    safe_segment,
    strip_notion_id,
    unique_path,
)
from .html_md import html_to_markdown

_MD_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]+?)(?:\s+\"[^\"]*\")?\)")
_NOTE_EXTS = (".md", ".markdown", ".txt")
_HTML_EXTS = (".html", ".htm")


def _clean_path(path: str) -> list[str]:
    """Split an export path into segments with the Notion ids removed."""
    segments = [strip_notion_id(part) for part in path.split("/") if part]
    return [safe_segment(part) for part in segments if part.strip()]


def _csv_to_table(data: bytes, title: str) -> str:
    """A database CSV → a markdown table.

    Bounded: a Notion database can hold tens of thousands of rows, and a note
    that large is unusable and slow to render. The rest stays reachable as the
    individual row pages, which import as normal notes.
    """
    try:
        rows = list(csv.reader(io.StringIO(decode(data))))
    except (csv.Error, ValueError):
        return ""
    rows = [r for r in rows if any(cell.strip() for cell in r)]
    if not rows:
        return ""

    header, *body = rows
    limit = 500
    truncated = len(body) > limit
    body = body[:limit]

    def cell(value: str) -> str:
        # A pipe or a newline inside a cell breaks the table structure.
        return value.replace("|", "\\|").replace("\n", " ").strip()

    width = len(header)
    lines = [
        "| " + " | ".join(cell(h) for h in header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in body:
        padded = (row + [""] * width)[:width]
        lines.append("| " + " | ".join(cell(c) for c in padded) + " |")

    note = f"# {title}\n\n" + "\n".join(lines) + "\n"
    if truncated:
        note += f"\n*Showing the first {limit} rows; the full set imported as individual notes.*\n"
    return note


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()

    entries: list[tuple[str, bytes]] = []
    for name, data in iter_files(uploads):
        if is_export_noise(name):
            continue
        entries.append((name, data))

    if not entries:
        raise ImportError_(
            "Nothing importable found. In Notion: ••• → Export → Markdown & CSV, "
            "with “Include subpages” on, then upload the .zip Notion emails you."
        )

    #: Every note's cleaned title, so a link to "Page abc123…md" can be
    #: rewritten to [[Page]]. Built before any body is processed, because a
    #: link commonly points forwards to a page later in the archive.
    titles_by_original: dict[str, str] = {}
    for name, _ in entries:
        stem, ext = posixpath.splitext(posixpath.basename(name))
        if ext.lower() in _NOTE_EXTS + _HTML_EXTS:
            titles_by_original[posixpath.basename(name)] = strip_notion_id(stem) or stem

    def rewrite_links(text: str) -> str:
        def repl(match: re.Match[str]) -> str:
            label, target = match.group(1), match.group(2)
            if target.startswith(("http://", "https://", "mailto:", "#")):
                return match.group(0)
            basename = posixpath.basename(unquote(target))
            title = titles_by_original.get(basename)
            if not title:
                # Not a page we imported — an asset, or a link out of scope.
                return match.group(0)
            label_clean = strip_notion_id(label).strip()
            return f"[[{title}]]" if label_clean in ("", title) else f"[[{title}|{label_clean}]]"

        return _MD_LINK.sub(repl, text)

    had_csv = False

    for name, data in entries:
        base = posixpath.basename(name)
        stem, ext = posixpath.splitext(base)
        ext = ext.lower()
        segments = _clean_path(name)
        if not segments:
            continue
        title = strip_notion_id(stem) or stem

        if ext in _NOTE_EXTS:
            body = rewrite_links(decode(data))
            # Notion opens every export with "# Title" then the page's
            # properties as loose "Key: value" lines. The heading is kept, the
            # property block is left as written — turning it into frontmatter
            # would guess at types and get dates wrong.
            path = unique_path(taken, "/".join([*segments[:-1], safe_segment(title)]) + ".md")
            document = body if body.lstrip().startswith("#") else f"# {title}\n\n{body}"
            result.add(path, _stamped(document))
        elif ext in _HTML_EXTS:
            body = rewrite_links(html_to_markdown(decode(data)))
            path = unique_path(taken, "/".join([*segments[:-1], safe_segment(title)]) + ".md")
            result.add(path, _stamped(f"# {title}\n\n{body}\n"))
        elif ext == ".csv":
            had_csv = True
            # Notion emits "Database.csv" and "Database_all.csv"; the second is
            # the same rows without the current view's filters. One is enough.
            if stem.endswith("_all"):
                continue
            table = _csv_to_table(data, title)
            if table:
                path = unique_path(taken, "/".join([*segments[:-1], safe_segment(f"{title} (database)")]) + ".md")
                result.add(path, _stamped(table))
        else:
            path = unique_path(taken, "/".join(segments))
            result.add_binary(path, data)

    if had_csv:
        result.warn(
            "Notion databases came across as markdown tables and individual notes. "
            "Board, calendar and relation views have no equivalent here."
        )
    if result.note_count == 0:
        raise ImportError_("That archive had no Notion pages in it.")
    return result


def _stamped(document: str) -> str:
    """Prefix `source: notion`, unless the page already carries frontmatter.

    Stamping the source is what makes "show me everything that came from
    Notion" a one-line search a year later. Skipping documents that already
    open with `---` avoids producing two frontmatter blocks, which YAML reads
    as one malformed one.
    """
    if document.lstrip().startswith("---"):
        return document
    return frontmatter({"source": "notion"}) + document


def is_export_noise(name: str) -> bool:
    lower = name.lower()
    return lower.endswith((".ds_store", "index.html")) and "/" not in lower.strip("/")
