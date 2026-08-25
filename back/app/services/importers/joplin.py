"""Joplin `.jex` → markdown, with the notebook tree rebuilt.

A JEX is a tar of files named `<32-hex-id>.md`. Each holds the note's body,
then a blank line, then a flat metadata block — `id:`, `parent_id:`, `type_:`
and so on. `type_: 1` is a note, `type_: 2` is a notebook, and the notebook
tree exists only as `parent_id` pointers between those ids.

So the ids have to be resolved before anything can be written: without that
pass every note lands at the vault root with a hexadecimal filename, which is
the state most Joplin importers leave people in.

Joplin's plain "MD directory" export needs none of this and is handled by the
markdown converter instead.
"""

from __future__ import annotations

from typing import Any

from .archives import decode, iter_files
from .base import (
    ConvertResult,
    ImportError_,
    UploadedFile,
    frontmatter,
    iso_from_epoch,
    safe_segment,
    unique_path,
)

_MAX_TREE_DEPTH = 20


def _parse(text: str) -> tuple[str, dict[str, str]]:
    """Split a Joplin item into (body, metadata).

    The metadata is the trailing run of `key: value` lines. Scanning upward
    from the end is what keeps a note whose body happens to contain "id: 4"
    from being misread as metadata.
    """
    lines = text.replace("\r\n", "\n").split("\n")
    first_meta = len(lines)
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index]
        if not line.strip():
            continue
        if ":" in line and not line.startswith((" ", "\t", "#", "-", ">", "*")):
            key = line.split(":", 1)[0]
            if key and key.replace("_", "").isalnum():
                first_meta = index
                continue
        break

    meta: dict[str, str] = {}
    for line in lines[first_meta:]:
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return "\n".join(lines[:first_meta]).strip(), meta


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()

    notes: list[tuple[str, dict[str, str]]] = []
    folders: dict[str, dict[str, str]] = {}

    for name, data in iter_files(uploads):
        if not name.lower().endswith(".md"):
            continue
        body, meta = _parse(decode(data))
        kind = meta.get("type_")
        # Joplin does not write a `title:` key: an item's title is the first
        # line of its body, and for a notebook (type_ 2) that line is the
        # *whole* body. Missing this puts every note under "Notebook".
        if not meta.get("title") and body:
            meta = {**meta, "title": body.split("\n", 1)[0].strip()}
        if kind == "2" and meta.get("id"):
            folders[meta["id"]] = meta
        elif kind == "1" or (kind is None and body):
            notes.append((body, meta))

    if not notes:
        raise ImportError_("No Joplin notes found. In Joplin: File → Export → JEX, then upload the .jex file.")

    def folder_path(parent_id: str | None) -> list[str]:
        """Walk parent_id up to the root, guarding against a cyclic export."""
        segments: list[str] = []
        seen: set[str] = set()
        current = parent_id
        while current and current in folders and current not in seen and len(segments) < _MAX_TREE_DEPTH:
            seen.add(current)
            title = folders[current].get("title") or "Notebook"
            segments.insert(0, safe_segment(title, fallback="Notebook"))
            current = folders[current].get("parent_id") or None
        return segments

    for body, meta in notes:
        title = (meta.get("title") or "").strip() or "Untitled"
        # The title *is* the body's first line in Joplin's format, so emitting
        # both would print the note's name twice at the top of every note.
        first, _, rest = body.partition("\n")
        if first.strip() == title:
            body = rest.lstrip("\n")
        segments = ["Joplin", *folder_path(meta.get("parent_id")), safe_segment(title)]
        properties: dict[str, Any] = {
            "source": "joplin",
            "created": iso_from_epoch(meta.get("user_created_time") or meta.get("created_time"), unit="ms"),
            "updated": iso_from_epoch(meta.get("user_updated_time") or meta.get("updated_time"), unit="ms"),
            "url": meta.get("source_url") or None,
        }
        heading = "" if body.lstrip().startswith("#") else f"# {title}\n\n"
        result.add(unique_path(taken, "/".join(segments) + ".md"), frontmatter(properties) + heading + body + "\n")

    result.warn(
        "Joplin resources (images and attachments) live outside the note files in a JEX and are "
        "not carried across — export as “MD directory” as well if you need them."
    )
    return result
