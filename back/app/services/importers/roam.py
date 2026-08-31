"""Roam Research JSON export → markdown outlines.

Roam exports one JSON array of pages, each a tree of blocks. Two things
transfer for free, which is why a Roam import lands better than most: Roam
already writes `[[page links]]` and `#tags` in the same syntax this vault uses,
so links resolve on import and the graph is populated immediately.

What cannot transfer is block references. `((uid))` addresses a single bullet,
and there is no bullet-level address in a document model — so rather than
leaving dead `((BSm2z0Xk9))` strings scattered through the notes, each one is
resolved to the text it pointed at and marked as a quote. The reader keeps the
content; only the live link is lost, and the warning says so.
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
    iso_from_epoch,
    safe_path,
    unique_path,
)

_MAX_DEPTH = 24


def _collect_blocks(node: dict[str, Any], out: dict[str, str]) -> None:
    """Index every block by uid so `((ref))` can be resolved later."""
    uid = node.get("uid")
    if uid:
        out[str(uid)] = str(node.get("string") or "")
    for child in node.get("children") or []:
        if isinstance(child, dict):
            _collect_blocks(child, out)


def _render(node: dict[str, Any], blocks: dict[str, str], depth: int = 0) -> list[str]:
    """One block and its children as nested markdown bullets."""
    if depth > _MAX_DEPTH:
        return []
    text = str(node.get("string") or "").strip()
    lines: list[str] = []
    if text:
        for uid, body in _refs_in(text):
            resolved = blocks.get(uid)
            text = text.replace(f"(({uid}))", f"“{resolved.strip()}”" if resolved else body)
        indent = "    " * depth
        # Roam's heading blocks carry a numeric level rather than markdown.
        level = node.get("heading")
        if isinstance(level, int) and 1 <= level <= 6 and depth == 0:
            lines.append(f"{'#' * (level + 1)} {text}")
        else:
            first, *rest = text.split("\n")
            lines.append(f"{indent}- {first}")
            lines.extend(f"{indent}  {line}" for line in rest)
    for child in node.get("children") or []:
        if isinstance(child, dict):
            lines.extend(_render(child, blocks, depth + 1 if text else depth))
    return lines


def _refs_in(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    start = 0
    while True:
        open_at = text.find("((", start)
        if open_at == -1:
            break
        close_at = text.find("))", open_at)
        if close_at == -1:
            break
        uid = text[open_at + 2 : close_at]
        if uid and " " not in uid:
            out.append((uid, text[open_at : close_at + 2]))
        start = close_at + 2
    return out


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()
    pages: list[dict[str, Any]] = []

    for name, data in iter_files(uploads):
        if not name.lower().endswith(".json"):
            continue
        try:
            payload = json.loads(decode(data))
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(payload, list):
            pages.extend(p for p in payload if isinstance(p, dict) and "title" in p)

    if not pages:
        raise ImportError_("No Roam pages found. In Roam: ••• → Export All → JSON, then upload the .zip or .json.")

    blocks: dict[str, str] = {}
    for page in pages:
        _collect_blocks(page, blocks)

    had_refs = False
    for page in pages:
        title = str(page.get("title") or "Untitled").strip() or "Untitled"
        lines: list[str] = []
        for child in page.get("children") or []:
            if isinstance(child, dict):
                lines.extend(_render(child, blocks))
        if any(_refs_in(str(b.get("string") or "")) for b in (page.get("children") or []) if isinstance(b, dict)):
            had_refs = True

        meta = {
            "source": "roam",
            "created": iso_from_epoch(page.get("create-time"), unit="ms"),
            "updated": iso_from_epoch(page.get("edit-time"), unit="ms"),
        }
        body = "\n".join(lines).strip()
        # Roam daily notes are titled "January 15th, 2024"; they keep that
        # title, so they sit alongside this vault's own daily notes rather than
        # colliding with them.
        result.add(
            unique_path(taken, safe_path(["Roam", title])),
            frontmatter(meta) + f"# {title}\n\n{body}\n" if body else frontmatter(meta) + f"# {title}\n",
        )

    if had_refs:
        result.warn(
            "Roam block references ((uid)) were replaced with the text they pointed at — "
            "the words are kept, the live reference is not."
        )
    return result
