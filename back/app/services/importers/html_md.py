"""HTML → markdown, shared by every source whose "notes" are really HTML.

Evernote's ENML, Google Keep's Takeout pages, Apple Notes exports, web
clippings and Notion's HTML export are all HTML underneath. One converter
serves all of them, so a fix to list handling or table handling lands
everywhere at once.

markdownify does the conversion. What this module adds is the cleanup either
side of it: stripping the wrappers these exports bury content in, keeping the
markdown from arriving with forty blank lines in it, and — importantly —
neutralising anything that would execute or phone home, since the input is a
file a stranger uploaded.
"""

from __future__ import annotations

import re

_STRIP_TAGS = ("script", "style", "noscript", "iframe", "object", "embed", "svg", "canvas")

#: Evernote wraps every note in <en-note>; Keep and Apple use a full document.
_UNWRAP = re.compile(r"</?(?:en-note|html|head|body|meta|link|base)\b[^>]*>", re.IGNORECASE)
_COMMENTS = re.compile(r"<!--.*?-->", re.DOTALL)
_BLANKS = re.compile(r"\n{3,}")
#: markdownify escapes these for safety; inside a knowledge base they are the
#: syntax people actually typed, and leaving them escaped ruins every import.
_OVER_ESCAPED = re.compile(r"\\([\[\]#*_`~])")


def _drop_dangerous(html: str) -> str:
    """Remove elements that execute, load remotely, or hide content.

    The uploaded file is untrusted. Markdown output is rendered in the app, and
    while the renderer sanitises too, stripping here means a malicious clipping
    never becomes note content in the first place — and it keeps a page of
    minified JavaScript from being imported as somebody's "note".
    """
    for tag in _STRIP_TAGS:
        html = re.sub(rf"<{tag}\b[^>]*>.*?</{tag}\s*>", " ", html, flags=re.IGNORECASE | re.DOTALL)
        html = re.sub(rf"<{tag}\b[^>]*/?>", " ", html, flags=re.IGNORECASE)
    # Inline handlers and javascript: targets, in case a tag survived above.
    html = re.sub(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", " ", html, flags=re.IGNORECASE)
    html = re.sub(r"(href|src)\s*=\s*([\"']?)\s*javascript:[^\"'>]*\2", r"\1=\2#\2", html, flags=re.IGNORECASE)
    return html


def html_to_markdown(html: str, *, heading_style: str = "ATX") -> str:
    """Convert an HTML fragment or document to markdown.

    Falls back to a plain-text extraction if markdownify is somehow missing, so
    an import degrades to "the words, without formatting" rather than failing.
    """
    if not html or not html.strip():
        return ""

    cleaned = _COMMENTS.sub(" ", html)
    cleaned = _drop_dangerous(cleaned)
    cleaned = _UNWRAP.sub("", cleaned)

    try:
        from markdownify import markdownify as _md

        text = _md(
            cleaned,
            heading_style=heading_style,
            # Keep the bullet character stable across nesting levels so the
            # result round-trips through the editor unchanged.
            bullets="-",
        )
    except Exception:  # pragma: no cover - only when the dependency is absent
        text = re.sub(r"<br\s*/?>", "\n", cleaned, flags=re.IGNORECASE)
        text = re.sub(r"</(p|div|li|h[1-6]|tr)>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)

    text = _OVER_ESCAPED.sub(r"\1", text)
    text = text.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    # Trailing spaces are markdown's hard-line-break syntax; exports are full of
    # them by accident, which double-spaces the whole note.
    text = re.sub(r"[ \t]+\n", "\n", text)
    return _BLANKS.sub("\n\n", text).strip()


def html_to_text(html: str) -> str:
    """Words only — for descriptions and previews, never for note bodies."""
    text = re.sub(r"<[^>]+>", " ", _drop_dangerous(html or ""))
    return re.sub(r"\s+", " ", text).strip()
