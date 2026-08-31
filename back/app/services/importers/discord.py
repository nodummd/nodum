"""Discord data package → notes, one per channel per day.

The package, not the API — and deliberately so. A bot can only read channels it
has been invited to and only messages sent after it joined, and driving a user
account with a script ("self-botting") is a bannable Terms of Service
violation. Requesting your data under Settings → Privacy & Safety → Request all
of my data is the supported route; Discord emails a zip within about 30 days.

Layout: `messages/c<channel-id>/channel.json` plus `messages.json` (newer
packages) or `messages.csv` (older ones). Both are handled, because which one
you get depends on when the export was produced.
"""

from __future__ import annotations

import csv
import io
import json
import posixpath
from datetime import datetime
from typing import Any

from .archives import decode, iter_files
from .base import ConvertResult, ImportError_, UploadedFile, safe_path, safe_segment, unique_path
from .transcripts import Message, emit_by_day

_ROOT = "Discord"


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    for candidate in (text, text.split(".")[0] + "+00:00"):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue
    return None


def _channel_label(meta: dict[str, Any], folder: str) -> str:
    """A readable name for a channel that may only have numeric ids.

    DMs carry no name at all, only recipient ids, so they fall back to the
    folder — which at least stays stable and unique.
    """
    name = (meta.get("name") or "").strip()
    guild = ((meta.get("guild") or {}).get("name") or "").strip()
    if name and guild:
        return safe_segment(f"{guild} #{name}")
    if name:
        return safe_segment(name)
    kind = meta.get("type")
    if kind in ("DM", 1):
        return safe_segment(f"Direct message {folder}")
    return safe_segment(folder or "channel")


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()

    channels: dict[str, dict[str, Any]] = {}
    raw_messages: dict[str, list[dict[str, Any]]] = {}

    for name, data in iter_files(uploads):
        parts = name.split("/")
        if "messages" not in parts:
            continue
        base = posixpath.basename(name).lower()
        folder = posixpath.basename(posixpath.dirname(name))
        if not folder or folder == "messages":
            continue

        if base == "channel.json":
            try:
                payload = json.loads(decode(data))
            except (json.JSONDecodeError, ValueError):
                payload = {}
            if isinstance(payload, dict):
                channels[folder] = payload
        elif base == "messages.json":
            try:
                payload = json.loads(decode(data))
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(payload, list):
                raw_messages.setdefault(folder, []).extend(p for p in payload if isinstance(p, dict))
        elif base == "messages.csv":
            try:
                rows = list(csv.DictReader(io.StringIO(decode(data))))
            except (csv.Error, ValueError):
                continue
            raw_messages.setdefault(folder, []).extend(rows)

    if not raw_messages:
        raise ImportError_(
            "No Discord messages found. In Discord: User Settings → Data & Privacy → "
            "Request all of my data, then upload the .zip Discord emails you."
        )

    # The package records the author only in the account's own export, so every
    # message in it is yours. Saying so once is clearer than labelling 40,000
    # messages "Unknown".
    indexed: list[str] = []
    for folder, rows in sorted(raw_messages.items()):
        meta = channels.get(folder, {})
        label = _channel_label(meta, folder)
        messages: list[Message] = []
        for row in rows:
            text = str(row.get("Contents") or row.get("contents") or "").strip()
            attachments = str(row.get("Attachments") or row.get("attachments") or "").strip()
            extras = [f"📎 {a}" for a in attachments.split() if a.startswith("http")]
            if not text and not extras:
                continue
            messages.append(
                Message(
                    timestamp=_parse_time(row.get("Timestamp") or row.get("timestamp")),
                    author="You",
                    text=text,
                    extras=extras or None,
                )
            )
        if not messages:
            continue
        index = emit_by_day(
            result,
            taken,
            root=_ROOT,
            channel=label,
            messages=messages,
            source="discord",
            extra_meta={"guild": ((meta.get("guild") or {}).get("name") or None)},
        )
        if index:
            indexed.append(index)

    if not indexed:
        result.warn("The package was readable but contained no messages.")
        return result

    listing = "\n".join(f"- [[{channel}]]" for channel in indexed)
    result.add(
        unique_path(taken, safe_path([_ROOT, "Discord channels"])),
        f"# Discord channels\n\nImported from a data package — {len(indexed)} conversations.\n\n{listing}\n",
    )
    result.warn("A Discord data package contains only your own messages — replies from other people are not in it.")
    return result
