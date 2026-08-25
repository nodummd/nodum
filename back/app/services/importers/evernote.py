"""Evernote `.enex` → markdown.

ENEX is Evernote's XML export and, since the API was deprecated and developer
tokens withdrawn, it is the only supported way out of Evernote. One file holds
many notes; each note's body is ENML — a constrained HTML dialect — and its
attachments are base64 `<resource>` elements referenced from the body by the
MD5 of their own bytes.

That MD5 indirection is the part worth getting right. `<en-media hash="…"/>`
is how an image appears inside a note, so without resolving hashes back to
filenames every picture in a migrated Evernote library silently disappears.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import posixpath
import re
from typing import Any

from .archives import decode, iter_files
from .base import ConvertResult, ImportError_, UploadedFile, note_text, safe_path, safe_segment, tag_name, unique_path
from .html_md import html_to_markdown

_EN_MEDIA = re.compile(r"<en-media\b[^>]*/?>", re.IGNORECASE)
_ATTR = re.compile(r'(\w[\w-]*)\s*=\s*"([^"]*)"')
#: Evernote writes "20240115T093000Z".
_EN_TIME = re.compile(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$")


def _parse_time(value: str | None) -> str | None:
    if not value:
        return None
    match = _EN_TIME.match(value.strip())
    if not match:
        return None
    y, mo, d, h, mi, s = match.groups()
    return f"{y}-{mo}-{d}T{h}:{mi}:{s}+00:00"


def _text(node: Any, tag: str) -> str | None:
    child = node.find(tag)
    return child.text if child is not None and child.text else None


def _resource_filename(resource: Any, index: int, mime: str) -> str:
    attrs = resource.find("resource-attributes")
    name = _text(attrs, "file-name") if attrs is not None else None
    if name:
        return safe_segment(name, fallback=f"attachment-{index}")
    # No filename is common for pasted screenshots; derive one from the mime.
    ext = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "application/pdf": "pdf",
    }.get(mime.lower(), "bin")
    return f"attachment-{index}.{ext}"


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    from defusedxml import ElementTree as SafeET

    result = ConvertResult()
    taken: set[str] = set()
    found_any = False

    for name, data in iter_files(uploads):
        if not name.lower().endswith(".enex"):
            continue
        found_any = True
        notebook = safe_segment(posixpath.splitext(posixpath.basename(name))[0], fallback="Evernote")

        try:
            root = SafeET.fromstring(decode(data))
        except Exception:
            result.warn(f"“{posixpath.basename(name)}” is not readable ENEX and was skipped.")
            continue

        for note in root.iter("note"):
            title = (_text(note, "title") or "Untitled").strip() or "Untitled"
            body_html = _text(note, "content") or ""

            # ── resources → attachments, keyed by the MD5 the body references
            by_hash: dict[str, str] = {}
            attachment_names: list[str] = []
            for index, resource in enumerate(note.iter("resource"), start=1):
                raw = _text(resource, "data")
                if not raw:
                    continue
                try:
                    blob = base64.b64decode(re.sub(r"\s+", "", raw), validate=False)
                except (binascii.Error, ValueError):
                    result.warn(f"An attachment in “{title}” was corrupt and was skipped.")
                    continue
                mime = _text(resource, "mime") or "application/octet-stream"
                filename = _resource_filename(resource, index, mime)
                path = unique_path(taken, f"{notebook}/attachments/{filename}")
                result.add_binary(path, blob)
                by_hash[hashlib.md5(blob, usedforsecurity=False).hexdigest()] = posixpath.basename(path)
                attachment_names.append(posixpath.basename(path))

            def _embed(match: re.Match[str], _by_hash: dict[str, str] = by_hash) -> str:
                attrs = dict(_ATTR.findall(match.group(0)))
                filename = _by_hash.get((attrs.get("hash") or "").lower())
                # An unresolved hash means the resource was not in the file —
                # Evernote does this for notes whose attachment failed to sync.
                return f"\n![[{filename}]]\n" if filename else "\n*(attachment missing from the export)*\n"

            body_html = _EN_MEDIA.sub(_embed, body_html)
            body = html_to_markdown(body_html)

            attrs = note.find("note-attributes")
            source_url = _text(attrs, "source-url") if attrs is not None else None
            tags = [tag_name(t.text) for t in note.iter("tag") if t.text]

            meta: dict[str, Any] = {
                "source": "evernote",
                "created": _parse_time(_text(note, "created")),
                "updated": _parse_time(_text(note, "updated")),
                "tags": [t for t in tags if t],
                "url": source_url,
            }
            path = unique_path(taken, safe_path([notebook, title]))
            result.add(path, note_text(title, body, meta))

    if not found_any:
        raise ImportError_(
            "No .enex file found. In Evernote, right-click a notebook → Export notes… → ENEX, "
            "then upload the file you get."
        )
    if result.note_count == 0:
        result.warn("The export was readable but contained no notes.")
    return result
