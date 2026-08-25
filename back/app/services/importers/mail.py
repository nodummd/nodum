"""Email (`.mbox` from Google Takeout, or loose `.eml`) → notes.

Gmail is export-only here, and that is not a shortcut. Gmail's API scopes are
*restricted*, which since 2024 means an annual third-party CASA security
assessment costing five figures and repeated every twelve months to keep
access. No free, self-hostable project can carry that, and any importer
claiming a one-click Gmail connection is either enterprise-priced or reading
your mail through something you should not trust. Takeout gives the same data
for nothing.

Gmail's mbox carries `X-Gmail-Labels`, so mail lands in folders named after the
labels you already use rather than one undifferentiated heap.
"""

from __future__ import annotations

import email
import email.policy

# Imported explicitly: `import email` alone does not bind the submodule, and
# relying on email.policy to pull it in transitively is a runtime NameError
# waiting for a CPython refactor.
import email.utils
import re
from email.header import decode_header, make_header
from email.message import EmailMessage
from typing import Any

from .archives import iter_files
from .base import ConvertResult, ImportError_, UploadedFile, note_text, safe_path, safe_segment, unique_path
from .html_md import html_to_markdown

_ROOT = "Mail"
#: mbox separates messages with a line starting "From " at column 0.
_MBOX_SEP = re.compile(rb"^From .*$", re.MULTILINE)
#: Quoted-reply chains triple the size of a thread and add nothing.
_QUOTED = re.compile(r"^(>.*\n?)+", re.MULTILINE)
_MAX_BODY_CHARS = 40_000


def _header(message: EmailMessage, name: str) -> str:
    raw = message.get(name)
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(str(raw)))).strip()
    except (UnicodeDecodeError, LookupError, ValueError):
        return str(raw).strip()


def _body(message: EmailMessage) -> tuple[str, list[str]]:
    """Best-effort readable body, plus the names of any attachments."""
    attachments: list[str] = []
    plain: str | None = None
    html: str | None = None

    for part in message.walk():
        disposition = (part.get_content_disposition() or "").lower()
        if disposition == "attachment":
            filename = part.get_filename()
            if filename:
                attachments.append(safe_segment(str(filename)))
            continue
        content_type = part.get_content_type()
        if content_type not in ("text/plain", "text/html"):
            continue
        try:
            payload = part.get_payload(decode=True)
        except Exception:
            continue
        if not payload:
            continue
        charset = part.get_content_charset() or "utf-8"
        try:
            text = payload.decode(charset, errors="replace")
        except (LookupError, UnicodeDecodeError):
            text = payload.decode("utf-8", errors="replace")
        if content_type == "text/plain" and plain is None:
            plain = text
        elif content_type == "text/html" and html is None:
            html = text

    body = plain if plain and plain.strip() else html_to_markdown(html or "")
    body = (body or "").strip()
    # Drop the quoted history: a long thread otherwise repeats every earlier
    # message in every note, and search matches all of them.
    trimmed = _QUOTED.sub("", body).strip()
    if trimmed:
        body = trimmed
    if len(body) > _MAX_BODY_CHARS:
        body = body[:_MAX_BODY_CHARS].rstrip() + "\n\n*(truncated)*"
    return body, attachments


def _split_mbox(data: bytes) -> list[bytes]:
    positions = [m.start() for m in _MBOX_SEP.finditer(data)]
    if not positions:
        return [data]
    chunks: list[bytes] = []
    for index, start in enumerate(positions):
        end = positions[index + 1] if index + 1 < len(positions) else len(data)
        chunk = data[start:end]
        newline = chunk.find(b"\n")
        chunks.append(chunk[newline + 1 :] if newline != -1 else b"")
    return [c for c in chunks if c.strip()]


def _folder_for(message: EmailMessage) -> str:
    """Gmail labels first, then a sensible fallback."""
    labels = _header(message, "X-Gmail-Labels")
    if labels:
        for label in (label.strip() for label in labels.split(",")):
            # These describe state, not topic, and would swallow everything.
            if label and label.lower() not in ("unread", "opened", "important", "category personal"):
                return safe_segment(label.replace("Category ", ""))
    folder = _header(message, "X-Folder")
    return safe_segment(folder) if folder else "Inbox"


def convert(uploads: list[UploadedFile]) -> ConvertResult:
    result = ConvertResult()
    taken: set[str] = set()
    raw_messages: list[bytes] = []

    for name, data in iter_files(uploads):
        lower = name.lower()
        if lower.endswith((".eml", ".msg")):
            raw_messages.append(data)
        elif lower.endswith(".mbox") or data[:5] == b"From ":
            # Takeout names the file "All mail Including Spam and Trash.mbox",
            # but people rename it, so sniff the mbox separator as well.
            raw_messages.extend(_split_mbox(data))

    if not raw_messages:
        raise ImportError_(
            "No mail found. For Gmail, export at takeout.google.com with only Mail selected and "
            "upload the .mbox; for other clients, export messages as .eml files."
        )

    had_attachments = False
    for raw in raw_messages:
        try:
            message = email.message_from_bytes(raw, policy=email.policy.default)
        except Exception:
            continue
        if not isinstance(message, EmailMessage):  # pragma: no cover - policy guarantees this
            continue

        subject = _header(message, "Subject") or "(no subject)"
        sender = _header(message, "From")
        date = _header(message, "Date")
        body, attachments = _body(message)
        if not body and not subject:
            continue
        if attachments:
            had_attachments = True
            body = f"{body}\n\n---\n\nAttachments: " + ", ".join(attachments)

        # A date prefix keeps a folder of mail in the order it arrived, which
        # is how people look for it.
        day = ""
        try:
            parsed = email.utils.parsedate_to_datetime(date) if date else None
            day = parsed.strftime("%Y-%m-%d") if parsed else ""
        except (TypeError, ValueError):
            day = ""

        title = f"{day} {subject}".strip() if day else subject
        meta: dict[str, Any] = {
            "source": "email",
            "from": sender,
            "to": _header(message, "To"),
            "date": date,
            "subject": subject,
        }
        path = unique_path(taken, safe_path([_ROOT, _folder_for(message), title]))
        result.add(path, note_text(subject, body, meta))

    if result.note_count == 0:
        raise ImportError_("The mailbox was readable but held no messages.")
    if had_attachments:
        result.warn(
            "Mail attachments were listed by name but not imported — a mailbox's attachments are "
            "usually far larger than the notes, and would dominate the vault."
        )
    return result
