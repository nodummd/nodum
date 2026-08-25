"""Shared types and helpers for import converters.

## The shape of the whole subsystem

`vault_io_service.import_zip` already does the hard part of an import: it
creates the folder tree, resolves name collisions Obsidian-style, extracts
links and tags, resolves wikilinks *across the whole batch* so cross-references
land regardless of order, and stores binary files as attachments.

None of that is source-specific. So a converter never touches the database. It
takes the bytes a person uploaded and returns a **normalised archive** — plain
markdown files on vault-relative paths, plus any binaries — and the existing
pipeline imports it. That keeps every converter a pure function, which is why
they can be unit-tested without Postgres, and why adding the twentieth source
costs about a hundred lines rather than a rewrite.

The one thing a converter must get right is paths: they are the folder tree the
user will see, so they carry the source's own structure (notebook, channel,
label) rather than dumping four thousand notes at the root.
"""

from __future__ import annotations

import posixpath
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

# A file as it arrived from the browser: (filename, bytes).
UploadedFile = tuple[str, bytes]


@dataclass(frozen=True)
class OutputFile:
    """One file in the normalised archive, on a vault-relative POSIX path."""

    path: str
    data: bytes


@dataclass
class ConvertResult:
    """What a converter produces.

    `warnings` is surfaced to the user verbatim. It is where a converter is
    honest about what it could not carry across — a Roam block reference with
    no target, a Slack file that lives behind an expired URL, an encrypted
    Standard Notes item. Silently dropping content during a migration is the
    single worst thing an importer can do, because the person only finds out
    months later when they go looking for the note.
    """

    files: list[OutputFile] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    #: Notes the converter believes it produced, for the "…is being imported"
    #: message. The authoritative count comes back from the import itself.
    note_count: int = 0

    def add(self, path: str, text: str) -> None:
        self.files.append(OutputFile(path=path, data=text.encode("utf-8")))
        self.note_count += 1

    def add_binary(self, path: str, data: bytes) -> None:
        self.files.append(OutputFile(path=path, data=data))

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)


class ImportError_(Exception):
    """A converter could not read the upload at all.

    Raised for "this is not the file you think it is" — a zip that is not a
    zip, an ENEX with no notes. Anything partial should be a warning and a
    best-effort import instead, because half a migration beats none.
    """


Converter = Callable[[list[UploadedFile]], ConvertResult]


# ── path and text helpers ────────────────────────────────────────────────────

#: Characters the vault's own path validator refuses, plus the ones that make
#: a filename hostile on Windows. Applied to every segment a converter emits.
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
#: Notion appends a 32-hex id to every exported file and folder name.
_NOTION_ID = re.compile(r"[ \-_]?[0-9a-f]{32}(?=$|\.)", re.IGNORECASE)


def safe_segment(name: str, *, fallback: str = "Untitled") -> str:
    """One path segment, safe for the vault and for every filesystem.

    Trailing dots and spaces are stripped because Windows silently drops them,
    which turns two distinct notes into one collision at export time.
    """
    cleaned = _UNSAFE.sub(" ", name).replace("\u00a0", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if cleaned in ("", ".", ".."):
        return fallback
    # Long titles are legal in Postgres but break on encrypted volumes and in
    # zip round-trips, so bound them well short of the 255-byte filesystem cap.
    return cleaned[:120].strip() or fallback


def safe_path(segments: Iterable[str], *, suffix: str = ".md") -> str:
    """Join segments into a vault-relative path, each one sanitised.

    A segment containing "/" is split rather than mangled: callers naturally
    write `safe_path(["Google Keep/Archive", title])`, and sanitising that as
    one segment would produce a folder literally named "Google Keep Archive"
    instead of the two-level tree the caller meant.
    """
    parts: list[str] = []
    for segment in segments:
        for piece in str(segment).split("/"):
            if piece.strip():
                parts.append(safe_segment(piece))
    if not parts:
        parts = ["Untitled"]
    return "/".join(parts) + suffix


def strip_notion_id(name: str) -> str:
    """Drop the 32-hex id Notion appends to exported names.

    "Project Plan 1a2b…7890.md" → "Project Plan.md". Without this, every note
    title in a migrated Notion workspace ends in thirty-two characters of
    hexadecimal, and every wikilink to it has to repeat them.
    """
    return _NOTION_ID.sub("", name).strip()


def unique_path(taken: set[str], path: str) -> str:
    """Deduplicate within one converted archive.

    The importer resolves collisions against notes already in the vault, but it
    cannot see two entries in the same archive claiming one path — a Keep
    export with three untitled notes, or two Slack channels of the same name in
    different workspaces. Numbering them here keeps all three.
    """
    if path not in taken:
        taken.add(path)
        return path
    stem, ext = posixpath.splitext(path)
    n = 2
    while f"{stem} {n}{ext}" in taken:
        n += 1
        # Guard against a pathological archive spinning here forever.
        if n > 10_000:
            break
    candidate = f"{stem} {n}{ext}"
    taken.add(candidate)
    return candidate


# ── frontmatter ─────────────────────────────────────────────────────────────


#: Quote only where YAML would otherwise misread the value. The naive version
#: of this rule quoted anything containing a hyphen, which quoted every
#: hyphenated tag and every ISO date — and a quoted date is a *string*, so the
#: properties UI renders a text box instead of a date, and date queries stop
#: matching. Only a leading indicator character, a "key: value" lookalike, an
#: inline comment or surrounding whitespace actually needs the quotes.
_NEEDS_QUOTE = re.compile(r"""^\s|\s$|^[-?:,\[\]{}#&*!|>'"%@`]|:\s|\s#|\n""")
#: Bare words YAML reads as booleans or null rather than as text.
_RESERVED = {"true", "false", "yes", "no", "on", "off", "null", "none", "~"}


def _yaml_scalar(value: Any) -> str:
    text = str(value)
    if text == "" or _NEEDS_QUOTE.search(text) or text.strip().lower() in _RESERVED:
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def frontmatter(fields: dict[str, Any]) -> str:
    """A YAML frontmatter block, or "" when there is nothing worth writing.

    Emitted rather than hand-formatted per converter so that every source
    produces the same property names — `source`, `created`, `updated`, `tags`,
    `url` — and a vault assembled from four different apps can still be
    filtered on one query.
    """
    rows: list[str] = []
    for key, value in fields.items():
        if value is None or value == "" or value == []:
            continue
        if isinstance(value, (list, tuple, set)):
            items = [str(v) for v in value if str(v).strip()]
            if not items:
                continue
            rows.append(f"{key}:")
            rows.extend(f"  - {_yaml_scalar(item)}" for item in items)
        elif isinstance(value, bool):
            rows.append(f"{key}: {'true' if value else 'false'}")
        else:
            rows.append(f"{key}: {_yaml_scalar(value)}")
    if not rows:
        return ""
    return "---\n" + "\n".join(rows) + "\n---\n\n"


def note_text(title: str, body: str, meta: dict[str, Any] | None = None) -> str:
    """Frontmatter + an H1 + the body, in the order a markdown reader expects."""
    head = frontmatter(meta or {})
    body = (body or "").strip()
    return f"{head}# {title}\n\n{body}\n" if body else f"{head}# {title}\n"


# ── timestamps ──────────────────────────────────────────────────────────────


def iso_from_epoch(value: Any, *, unit: str = "s") -> str | None:
    """Epoch → ISO-8601, tolerant of the units these exports actually use.

    Keep writes microseconds, Slack writes float seconds, Discord writes
    milliseconds, and every one of them is occasionally null or a string.
    """
    if value in (None, "", 0):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    divisor = {"s": 1.0, "ms": 1_000.0, "us": 1_000_000.0, "ns": 1_000_000_000.0}.get(unit, 1.0)
    try:
        return datetime.fromtimestamp(number / divisor, tz=UTC).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def tag_name(label: str) -> str:
    """A label from another app, as a tag this vault can actually search.

    Spaces become hyphens because `#project alpha` tags "project" and leaves
    "alpha" as prose — a silent data-loss bug the first time someone imports a
    Keep label with a space in it.
    """
    cleaned = re.sub(r"[^\w/\- ]+", "", str(label), flags=re.UNICODE).strip()
    return re.sub(r"\s+", "-", cleaned)
