"""Standard Notes JSON backup → markdown.

Standard Notes exports a single JSON file of items. Two things matter:

**Encrypted backups cannot be read.** Standard Notes offers an encrypted export
and a decrypted one; only the decrypted export contains anything an importer
can use. An encrypted file parses fine as JSON and yields zero notes, so this
detects it and says so, rather than reporting a successful import of nothing.

**Not every item is a note.** The file also holds tags, editors, themes and
component state, all in the same `items` array.
"""

from __future__ import annotations

import json
from typing import Any

from .archives import decode, iter_files
from .base import (
    ConvertResult,
    ImportError_,
    UploadedFile,
    frontmatter,
    safe_path,
    tag_name,
    unique_path,
)


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()
    items: list[dict[str, Any]] = []

    for name, data in iter_files(uploads):
        if not name.lower().endswith(".json"):
            continue
        try:
            payload = json.loads(decode(data))
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            items.extend(i for i in payload["items"] if isinstance(i, dict))

    if not items:
        raise ImportError_(
            "No Standard Notes backup found. In Standard Notes: Account → Download backup → "
            "Decrypted, then upload the .zip or .json."
        )

    notes = [i for i in items if i.get("content_type") == "Note"]
    # An encrypted backup parses as perfectly valid JSON — every item is there,
    # but `content` is a ciphertext string rather than an object. Detected here
    # because the alternative is reporting a cheerful import of zero notes and
    # letting the person find out later.
    if notes and not any(isinstance(i.get("content"), dict) for i in notes):
        raise ImportError_(
            "That backup is encrypted, so its notes cannot be read. Download a *decrypted* "
            "backup from Standard Notes and upload that instead."
        )
    if not notes:
        if any(isinstance(i.get("content"), str) for i in items):
            raise ImportError_(
                "That backup is encrypted, so its notes cannot be read. Download a *decrypted* "
                "backup from Standard Notes and upload that instead."
            )
        raise ImportError_("That backup contained no notes.")

    # Tags are separate items that reference notes by uuid.
    tags_by_note: dict[str, list[str]] = {}
    for item in items:
        if item.get("content_type") != "Tag":
            continue
        content = item.get("content")
        if not isinstance(content, dict):
            continue
        label = tag_name(content.get("title") or "")
        for reference in content.get("references") or []:
            if isinstance(reference, dict) and reference.get("uuid") and label:
                tags_by_note.setdefault(str(reference["uuid"]), []).append(label)

    for note in notes:
        content = note.get("content")
        if not isinstance(content, dict):
            continue
        if content.get("trashed"):
            continue
        title = str(content.get("title") or "").strip() or "Untitled"
        body = str(content.get("text") or "")
        properties: dict[str, Any] = {
            "source": "standard-notes",
            "created": note.get("created_at"),
            "updated": note.get("updated_at"),
            "tags": tags_by_note.get(str(note.get("uuid") or ""), []),
            "pinned": bool((content.get("appData") or {}).get("org.standardnotes.sn", {}).get("pinned")) or None,
        }
        folder = "Standard Notes/Archive" if content.get("archived") else "Standard Notes"
        heading = "" if body.lstrip().startswith("#") else f"# {title}\n\n"
        result.add(
            unique_path(taken, safe_path([folder, title])),
            frontmatter(properties) + heading + body.strip() + "\n",
        )

    return result
