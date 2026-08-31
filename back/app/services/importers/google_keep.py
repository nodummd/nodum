"""Google Keep (via Google Takeout) → markdown.

There is no other way in. The Keep API is Workspace-only — a personal
@gmail.com account cannot authorise it at all, and the request to open it has
sat unanswered for years — so "connect your Google account" is not an option
anyone can offer for Keep, whatever the marketing on competing importers says.
Takeout is the export, and this reads it.

A Takeout archive holds `Takeout/Keep/<Note title>.json` (the good copy),
matching `.html` (the same content, prettier), and the note's attachments
alongside. The JSON is what gets parsed; the HTML is ignored, because parsing
both would import every note twice.
"""

from __future__ import annotations

import json
import posixpath
from typing import Any

from .archives import decode, iter_files
from .base import (
    ConvertResult,
    ImportError_,
    UploadedFile,
    iso_from_epoch,
    note_text,
    safe_path,
    tag_name,
    unique_path,
)

_ATTACHMENT_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".3gp", ".m4a", ".mp3", ".amr"}


def _checklist(items: list[dict[str, Any]]) -> str:
    """Keep's list notes → markdown task lists, checked state preserved.

    Keep nests one level (`parentServerId` on a child); rendering that as an
    indented sub-task keeps the structure the person actually made.
    """
    parents = [i for i in items if not i.get("parentServerId")]
    children: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        parent = item.get("parentServerId")
        if parent:
            children.setdefault(str(parent), []).append(item)

    def row(item: dict[str, Any], indent: str = "") -> str:
        mark = "x" if item.get("isChecked") else " "
        return f"{indent}- [{mark}] {str(item.get('text', '')).strip()}"

    lines: list[str] = []
    for item in parents or items:
        lines.append(row(item))
        for child in children.get(str(item.get("id") or item.get("serverId") or ""), []):
            lines.append(row(child, indent="    "))
    return "\n".join(lines)


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()
    #: Keep's JSON names attachments by a path relative to the Keep folder, so
    #: collect every binary first and only emit the ones a note references.
    binaries: dict[str, bytes] = {}
    notes: list[tuple[str, dict[str, Any]]] = []

    for name, data in iter_files(uploads):
        lower = name.lower()
        # Inside a Takeout the path is "Takeout/Keep/…", but people routinely
        # unzip and re-zip just the Keep folder, so fall back to matching on
        # the file type rather than requiring the directory.
        in_keep_folder = "/keep/" in f"/{lower}" or lower.startswith("keep/")
        looks_like_keep = lower.endswith(".json") or posixpath.splitext(lower)[1] in _ATTACHMENT_EXTS
        if not in_keep_folder and not looks_like_keep:
            continue
        base = posixpath.basename(name)
        if lower.endswith(".json"):
            # Takeout also drops metadata files that are not notes.
            if base in ("Labels.json", "Settings.json"):
                continue
            try:
                payload = json.loads(decode(data))
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(payload, dict) and (
                "textContent" in payload or "listContent" in payload or "title" in payload
            ):
                notes.append((base, payload))
        elif posixpath.splitext(lower)[1] in _ATTACHMENT_EXTS:
            binaries[base] = data

    if not notes:
        raise ImportError_(
            "No Keep notes found. Export from takeout.google.com with only Keep selected, "
            "then upload the .zip exactly as Google sends it."
        )

    used_attachments: set[str] = set()

    for filename, payload in notes:
        title = str(payload.get("title") or "").strip()
        body_parts: list[str] = []

        text = str(payload.get("textContent") or "").strip()
        if text:
            body_parts.append(text)

        items = payload.get("listContent")
        if isinstance(items, list) and items:
            body_parts.append(_checklist(items))

        embeds: list[str] = []
        for attachment in payload.get("attachments") or []:
            raw_path = str(attachment.get("filePath") or "")
            base = posixpath.basename(raw_path)
            # Takeout is famously inconsistent here: the JSON says ".jpeg"
            # while the file on disk is ".jpg". Match on the stem as a fallback
            # or every image in the export is dropped.
            match = (
                base
                if base in binaries
                else next((k for k in binaries if posixpath.splitext(k)[0] == posixpath.splitext(base)[0]), None)
            )
            if match:
                used_attachments.add(match)
                embeds.append(f"![[{match}]]")
            else:
                result.warn("Some Keep attachments were named in the notes but missing from the archive.")
        if embeds:
            body_parts.append("\n".join(embeds))

        for annotation in payload.get("annotations") or []:
            url = annotation.get("url")
            if url:
                body_parts.append(f"[{annotation.get('title') or url}]({url})")

        # Archived and trashed notes go to their own folders rather than mixing
        # with live ones — a Keep account of any age has hundreds of each.
        if payload.get("isTrashed"):
            folder = "Google Keep/Trash"
        elif payload.get("isArchived"):
            folder = "Google Keep/Archive"
        else:
            folder = "Google Keep"

        display_title = title or posixpath.splitext(filename)[0] or "Untitled"
        meta: dict[str, Any] = {
            "source": "google-keep",
            "created": iso_from_epoch(payload.get("createdTimestampUsec"), unit="us"),
            "updated": iso_from_epoch(payload.get("userEditedTimestampUsec"), unit="us"),
            "tags": [t for t in (tag_name(lbl.get("name", "")) for lbl in payload.get("labels") or []) if t],
            "pinned": bool(payload.get("isPinned")) or None,
            "color": (payload.get("color") or "").lower() if payload.get("color") not in (None, "DEFAULT") else None,
        }
        path = unique_path(taken, safe_path([folder, display_title]))
        result.add(path, note_text(display_title, "\n\n".join(p for p in body_parts if p), meta))

    for name in sorted(used_attachments):
        result.add_binary(unique_path(taken, f"Google Keep/attachments/{name}"), binaries[name])

    return result
