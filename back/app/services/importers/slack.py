"""Slack workspace export → notes, one per channel per day.

The export, not the API. Since May 2025 Slack rate-limits
`conversations.history` to **one request per minute** for new apps distributed
outside the Marketplace, which puts a thousand-message channel at roughly
sixteen hours of polling. A workspace export is a single zip that arrives in
minutes, so that is what this reads.

Layout: `channels.json` (or `groups.json`/`dms.json`), `users.json`, and one
directory per channel holding `YYYY-MM-DD.json` — already the grouping this
importer wants, so days pass through untouched.
"""

from __future__ import annotations

import json
import posixpath
from datetime import UTC, datetime
from typing import Any

from .archives import decode, iter_files
from .base import ConvertResult, ImportError_, UploadedFile, safe_path, unique_path
from .transcripts import Message, emit_by_day, slack_markup

_ROOT = "Slack"


def _load(data: bytes) -> Any:
    try:
        return json.loads(decode(data))
    except (json.JSONDecodeError, ValueError):
        return None


def _display_name(user: dict[str, Any]) -> str:
    profile = user.get("profile") or {}
    for key in ("display_name", "real_name"):
        value = (profile.get(key) or "").strip()
        if value:
            return value
    return (user.get("real_name") or user.get("name") or user.get("id") or "Unknown").strip()


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()

    users: dict[str, str] = {}
    channel_meta: dict[str, dict[str, Any]] = {}
    days: dict[str, list[tuple[str, Any]]] = {}

    for name, data in iter_files(uploads):
        if not name.lower().endswith(".json"):
            continue
        base = posixpath.basename(name)
        parent = posixpath.dirname(name).split("/")[-1] if "/" in name else ""

        if base == "users.json" and not parent:
            for user in _load(data) or []:
                if isinstance(user, dict) and user.get("id"):
                    users[str(user["id"])] = _display_name(user)
            continue

        if base in ("channels.json", "groups.json", "dms.json", "mpims.json") and not parent:
            for channel in _load(data) or []:
                if isinstance(channel, dict) and channel.get("name"):
                    channel_meta[str(channel["name"])] = channel
            continue

        # A day file: "<channel>/YYYY-MM-DD.json"
        if parent and len(base) == len("2024-01-15.json") and base[4] == "-" and base[7] == "-":
            days.setdefault(parent, []).append((base[:-5], _load(data)))

    if not days:
        raise ImportError_(
            "No Slack channel data found. In Slack: Settings & administration → Workspace settings "
            "→ Import/Export Data → Export, then upload the .zip you are emailed."
        )

    indexed: list[str] = []
    for channel, day_files in sorted(days.items()):
        messages: list[Message] = []
        for _day, payload in day_files:
            for raw in payload or []:
                if not isinstance(raw, dict):
                    continue
                # Joins, leaves and channel-topic changes are noise in a note.
                if raw.get("subtype") in ("channel_join", "channel_leave", "group_join", "group_leave"):
                    continue

                author = (
                    raw.get("user_profile", {}).get("display_name")
                    or users.get(str(raw.get("user") or ""))
                    or raw.get("username")
                    or raw.get("bot_id")
                    or "Unknown"
                )
                try:
                    stamp = datetime.fromtimestamp(float(raw.get("ts", 0)), tz=UTC)
                except (TypeError, ValueError, OSError, OverflowError):
                    stamp = None

                extras: list[str] = []
                for file_entry in raw.get("files") or []:
                    if isinstance(file_entry, dict) and file_entry.get("name"):
                        # Export files are private URLs that expire; naming them
                        # is honest, linking them would rot immediately.
                        extras.append(f"📎 {file_entry['name']}")
                for attachment in raw.get("attachments") or []:
                    fallback = (attachment or {}).get("fallback")
                    if fallback:
                        extras.append(str(fallback)[:400])
                for reaction in raw.get("reactions") or []:
                    if isinstance(reaction, dict) and reaction.get("name"):
                        extras.append(f":{reaction['name']}: \u00d7{reaction.get('count', 1)}")

                messages.append(
                    Message(
                        timestamp=stamp,
                        author=str(author),
                        text=slack_markup(str(raw.get("text") or ""), users),
                        extras=extras or None,
                    )
                )

        if not messages:
            continue
        meta = channel_meta.get(channel) or {}
        index = emit_by_day(
            result,
            taken,
            root=_ROOT,
            channel=channel,
            messages=messages,
            source="slack",
            extra_meta={"purpose": ((meta.get("purpose") or {}).get("value") or None)},
        )
        if index:
            indexed.append(index)

    if not indexed:
        result.warn("The export was readable but every channel in it was empty.")
        return result

    # A workspace index gives the graph a single hub instead of a wide, flat
    # cluster — and it is where a person starts reading after the import.
    listing = "\n".join(f"- [[{channel}]]" for channel in indexed)
    result.add(
        unique_path(taken, safe_path([_ROOT, "Slack channels"])),
        f"# Slack channels\n\nImported from a workspace export — {len(indexed)} channels.\n\n{listing}\n",
    )
    result.warn("Slack exports do not include file contents, only their names — shared files stay in Slack.")
    return result
