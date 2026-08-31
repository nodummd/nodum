"""Telegram Desktop JSON export → notes, one per chat per day.

Telegram Desktop → Settings → Advanced → Export Telegram data, format JSON,
produces `result.json`. That is the route because there is no third-party API
for reading your own history: the Bot API only sees messages sent to a bot
after it joined, and the user-level MTProto API is not something a note app
should be asking people to hand credentials for.

Saved Messages — Telegram's own scratchpad, and the reason most people want
this — comes through as an ordinary chat named "Saved Messages".
"""

from __future__ import annotations

import json
import posixpath
from datetime import datetime
from typing import Any

from .archives import decode, iter_files
from .base import ConvertResult, ImportError_, UploadedFile, safe_path, safe_segment, unique_path
from .transcripts import Message, emit_by_day

_ROOT = "Telegram"


def _flatten(text: Any) -> str:
    """Telegram's `text` is a string, or a list of strings and entity objects.

    The list form is how links, mentions, bold and code arrive. Rendering the
    entities keeps a message readable instead of collapsing it to bare words.
    """
    if isinstance(text, str):
        return text
    if not isinstance(text, list):
        return ""
    parts: list[str] = []
    for chunk in text:
        if isinstance(chunk, str):
            parts.append(chunk)
            continue
        if not isinstance(chunk, dict):
            continue
        value = str(chunk.get("text") or "")
        kind = chunk.get("type")
        if kind == "text_link" and chunk.get("href"):
            parts.append(f"[{value}]({chunk['href']})")
        elif kind in ("link", "url"):
            parts.append(value)
        elif kind == "code":
            parts.append(f"`{value}`")
        elif kind == "pre":
            parts.append(f"\n```\n{value}\n```\n")
        elif kind == "bold":
            parts.append(f"**{value}**")
        elif kind == "italic":
            parts.append(f"*{value}*")
        elif kind == "strikethrough":
            parts.append(f"~~{value}~~")
        elif kind in ("mention", "hashtag", "bot_command", "email", "phone"):
            parts.append(value)
        else:
            parts.append(value)
    return "".join(parts)


def _parse_time(message: dict[str, Any]) -> datetime | None:
    unix = message.get("date_unixtime")
    if unix:
        try:
            return datetime.fromtimestamp(int(unix), tz=None).astimezone()
        except (TypeError, ValueError, OSError, OverflowError):
            pass
    raw = message.get("date")
    if raw:
        try:
            return datetime.fromisoformat(str(raw))
        except ValueError:
            return None
    return None


def _chats(payload: Any) -> list[dict[str, Any]]:
    """A full export nests chats under `chats.list`; a single-chat export is flat."""
    if isinstance(payload, dict):
        listing = (payload.get("chats") or {}).get("list")
        if isinstance(listing, list):
            return [c for c in listing if isinstance(c, dict)]
        if isinstance(payload.get("messages"), list):
            return [payload]
    return []


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()
    chats: list[dict[str, Any]] = []

    for name, data in iter_files(uploads):
        if not name.lower().endswith(".json"):
            continue
        if posixpath.basename(name).lower() not in ("result.json", "messages.json") and len(data) < 32:
            continue
        try:
            payload = json.loads(decode(data))
        except (json.JSONDecodeError, ValueError):
            continue
        chats.extend(_chats(payload))

    if not chats:
        raise ImportError_(
            "No Telegram chats found. In Telegram Desktop: Settings → Advanced → Export Telegram data, "
            "choose JSON, then upload the result.json (or the whole folder)."
        )

    indexed: list[str] = []
    skipped_service = 0

    for chat in chats:
        name = safe_segment(str(chat.get("name") or chat.get("type") or "Chat"), fallback="Chat")
        messages: list[Message] = []
        for raw in chat.get("messages") or []:
            if not isinstance(raw, dict):
                continue
            if raw.get("type") == "service":
                # "X joined the group", pinned-message notices — noise in a note.
                skipped_service += 1
                continue
            text = _flatten(raw.get("text")).strip()
            extras: list[str] = []
            for key, label in (("photo", "🖼 photo"), ("file", "📎"), ("media_type", "media")):
                value = raw.get(key)
                if value:
                    extras.append(f"{label} {posixpath.basename(str(value))}" if key != "media_type" else f"({value})")
            if not text and not extras:
                continue
            messages.append(
                Message(
                    timestamp=_parse_time(raw),
                    author=str(raw.get("from") or raw.get("actor") or "Unknown"),
                    text=text,
                    extras=extras or None,
                )
            )

        if not messages:
            continue
        index = emit_by_day(result, taken, root=_ROOT, channel=name, messages=messages, source="telegram")
        if index:
            indexed.append(index)

    if not indexed:
        result.warn("The export was readable but contained no messages.")
        return result

    listing = "\n".join(f"- [[{chat}]]" for chat in indexed)
    result.add(
        unique_path(taken, safe_path([_ROOT, "Telegram chats"])),
        f"# Telegram chats\n\nImported from a Desktop export — {len(indexed)} chats.\n\n{listing}\n",
    )
    if skipped_service:
        result.warn(f"Skipped {skipped_service} service messages (joins, pins, calls).")
    result.warn(
        "Export with media if you want photos and files — this import records their names, "
        "and embeds them only when the media folder is included."
    )
    return result
