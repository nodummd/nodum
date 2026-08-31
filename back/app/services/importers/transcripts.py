"""Turning chat exports into notes.

Slack, Discord and Telegram all export the same thing in different shapes: an
ordered list of messages with an author, a timestamp and some text. The
interesting decision is not parsing them — it is what a *note* should be.

One note per message is unusable: a year of one Slack channel is forty thousand
notes, the graph is meaningless and search returns nothing but fragments. One
note per channel is worse: a single 8 MB document the editor struggles to open.

**One note per channel per day** is the shape that works. It matches how people
remember conversations ("that discussion in #design last Tuesday"), it gives
the graph a sensible node size, it lines up with daily notes, and it is what
Slack's own export already does — so for Slack there is no regrouping at all.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .base import ConvertResult, note_text, safe_path, unique_path

#: Slack-flavoured mentions and links: <@U123|name>, <#C123|channel>, <url|text>
_SLACK_ENTITY = re.compile(r"<([^>|]+)(?:\|([^>]*))?>")


@dataclass
class Message:
    """One message, normalised across the three sources."""

    timestamp: datetime | None
    author: str
    text: str
    #: Rendered under the message — file names, embeds, reactions.
    extras: list[str] | None = None


def slack_markup(text: str, users: dict[str, str] | None = None) -> str:
    """Slack's angle-bracket markup → markdown.

    Left alone, every mention in an imported channel reads `<@U04F2K9>` and
    every link reads `<https://…|the docs>`, which makes the transcript close
    to unreadable.
    """

    def repl(match: re.Match[str]) -> str:
        target, label = match.group(1), match.group(2)
        if target.startswith("@"):
            uid = target[1:]
            return "@" + ((users or {}).get(uid) or label or uid)
        if target.startswith("#"):
            return "#" + (label or target[1:].split("|")[0])
        if target.startswith(("http://", "https://", "mailto:")):
            return f"[{label}]({target})" if label else target
        if target.startswith("!"):
            return "@" + target[1:]  # @here, @channel
        return label or target

    text = _SLACK_ENTITY.sub(repl, text or "")
    # Slack writes &amp;/&lt;/&gt; and nothing else.
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def render_day(
    *,
    channel: str,
    day: str,
    messages: list[Message],
    source: str,
    extra_meta: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """One day of one channel → (title, note body with frontmatter).

    Authors are collected into `participants` so the note is findable by who
    was in it, which is usually how people search for a conversation.
    """
    lines: list[str] = []
    participants: list[str] = []
    for message in messages:
        if message.author and message.author not in participants:
            participants.append(message.author)
        clock = message.timestamp.strftime("%H:%M") if message.timestamp else "--:--"
        body = (message.text or "").strip()
        # Blockquote the message so multi-line pastes and code stay visually
        # attached to their author instead of merging into the next message.
        quoted = "\n".join(f"> {line}" if line.strip() else ">" for line in body.split("\n")) if body else ""
        lines.append(f"**{clock} — {message.author or 'Unknown'}**")
        if quoted:
            lines.append(quoted)
        for extra in message.extras or []:
            lines.append(f"> {extra}")
        lines.append("")

    title = f"{channel} — {day}"
    meta: dict[str, Any] = {
        "source": source,
        "channel": channel,
        "date": day,
        "participants": participants[:50],
        "messages": len(messages),
        **(extra_meta or {}),
    }
    return title, note_text(title, "\n".join(lines).strip(), meta)


def emit_by_day(
    result: ConvertResult,
    taken: set[str],
    *,
    root: str,
    channel: str,
    messages: list[Message],
    source: str,
    extra_meta: dict[str, Any] | None = None,
) -> str | None:
    """Group a channel's messages into per-day notes, plus a channel index.

    Returns the index note's title so a workspace-level index can link to it.
    Without these two levels the import lands as several thousand orphan notes
    — technically imported, and useless in the graph.
    """
    by_day: dict[str, list[Message]] = defaultdict(list)
    for message in messages:
        day = (message.timestamp or datetime.fromtimestamp(0, tz=UTC)).strftime("%Y-%m-%d")
        by_day[day].append(message)

    day_titles: list[str] = []
    for day in sorted(by_day):
        ordered = sorted(by_day[day], key=lambda m: m.timestamp or datetime.fromtimestamp(0, tz=UTC))
        title, body = render_day(channel=channel, day=day, messages=ordered, source=source, extra_meta=extra_meta)
        path = unique_path(taken, safe_path([root, channel, title]))
        result.add(path, body)
        day_titles.append(title)

    if not day_titles:
        return None

    # The channel index is named exactly after the channel, so `[[general]]`
    # from anywhere in the vault resolves to it.
    listing = "\n".join(f"- [[{title}]]" for title in day_titles)
    index_body = (
        f"{len(day_titles)} days, {sum(len(v) for v in by_day.values())} messages, "
        f"{min(by_day)} to {max(by_day)}.\n\n{listing}"
    )
    index_path = unique_path(taken, safe_path([root, channel, channel]))
    result.add(
        index_path,
        note_text(
            channel,
            index_body,
            {"source": source, "channel": channel, "days": len(day_titles), **(extra_meta or {})},
        ),
    )
    return channel
