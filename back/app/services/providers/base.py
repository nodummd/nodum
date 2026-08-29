"""The adapter contract for one-way sync from a third-party service.

Same discipline as `services/importers/`: the half that talks to the provider
and renders markdown is **pure** — it takes an access token and a cursor and
returns records — and the database half is shared glue in
`provider_sync_service`. An adapter never opens a transaction, never writes a
note, and never advances its own cursor. That is what makes every adapter
testable against a fake HTTP layer with no Postgres, and it is what keeps the
cursor-ordering rule (write, then advance, then commit) in exactly one place
rather than re-implemented per provider.

## The user-content contract

A synced note is two regions. Everything above `## Notes` belongs to the sync
and is rewritten freely. Everything from `## Notes` down belongs to the person
and is **never** touched. That heading is the whole reason a calendar entry in a
knowledge base is worth having — it is where you write what actually happened —
and overwriting it once would be unrecoverable and would end the feature's
credibility permanently.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

#: Where the sync's authority ends and the user's begins.
if TYPE_CHECKING:
    from datetime import datetime


USER_REGION_MARKER = "## Notes"


class ProviderError(Exception):
    """A provider call failed in a way the engine must classify.

    `error_class` drives the connection state machine: `auth` stops and asks
    the user to reconnect, `rate_limit` and `provider_5xx` back off, and
    `cursor_invalid` triggers a full resync. Anything unclassified is a bug on
    our side and is treated as transient so a deploy can fix it.
    """

    def __init__(self, message: str, *, error_class: str = "bug", retry_after: int | None = None) -> None:
        super().__init__(message)
        self.error_class = error_class
        self.retry_after = retry_after


class CursorInvalid(ProviderError):
    """The provider rejected our incremental token; a full resync is required."""

    def __init__(self, message: str = "Sync cursor expired; a full resync is needed.") -> None:
        super().__init__(message, error_class="cursor_invalid")


@dataclass(frozen=True)
class SyncRecord:
    """One provider record, already rendered into a note.

    `kind="tombstone"` means the record was deleted upstream; the engine
    decides what that means for the note (soft-delete, or leave it), which is a
    policy question and not the adapter's to make.
    """

    external_id: str
    kind: str = "note"
    title: str = ""
    #: Vault-relative folder, e.g. "Calendar/2026/08". Created on demand.
    folder: str = ""
    #: The sync-owned region: frontmatter, heading and body. Must NOT include
    #: the user region marker — the engine appends that.
    body: str = ""
    external_updated_at: datetime | None = None
    #: Monotonic where the provider offers one, so a late page cannot clobber
    #: a newer write. 0 when the provider has no such notion.
    external_version: int = 0
    payload: dict[str, Any] = field(default_factory=dict)
    #: Wikilink targets this record wants to exist — People notes, mostly. The
    #: engine creates them (or declines to) so that no adapter can flood the
    #: graph with ghost nodes on its own authority.
    wants_notes: tuple[str, ...] = ()

    def content_hash(self) -> str:
        return hashlib.sha256(self.body.encode("utf-8")).hexdigest()


@dataclass
class SyncPage:
    """One page of a walk."""

    records: list[SyncRecord] = field(default_factory=list)
    #: Mid-walk continuation. While this is set the walk is NOT finished and
    #: `next_cursor` must be ignored.
    next_page_token: str = ""
    #: The provider's incremental token for *next time*. Only ever set on the
    #: final page — persisting one from a middle page silently skips every
    #: record after it.
    next_cursor: str = ""
    #: True when this walk has no more pages.
    done: bool = True
    #: Adapter-suggested seconds until the next poll, if it knows better than
    #: the default (a quota hint, say).
    poll_interval_s: int | None = None


@dataclass
class FetchContext:
    """Everything an adapter needs for one page, and nothing else."""

    access_token: str
    stream: str
    cursor_token: str
    page_token: str
    #: The parameters the stored cursor was minted under. An adapter compares
    #: these with what it would send now and raises CursorInvalid on a
    #: mismatch rather than issuing a call whose result would be undefined.
    cursor_params: dict[str, Any]
    settings: dict[str, Any]
    #: True while walking history rather than the incremental tail.
    backfill: bool = False
    #: The vault's daily-note format, so date wikilinks resolve to real notes
    #: instead of becoming ghosts.
    daily_format: str = "YYYY-MM-DD"


@runtime_checkable
class ProviderAdapter(Protocol):
    """What every data source must implement."""

    #: Stable id used in stream names, settings keys and the API.
    id: str
    name: str
    #: Exact OAuth scope strings this adapter requires.
    scopes: tuple[str, ...]

    def streams(self, connection_settings: dict[str, Any]) -> list[str]:
        """Logical streams for this connection — one cursor each."""
        ...

    def cursor_params(self, stream: str, settings: dict[str, Any]) -> dict[str, Any]:
        """The frozen query parameters a cursor for `stream` is minted under."""
        ...

    async def fetch(self, ctx: FetchContext) -> SyncPage:
        """Fetch one page. Pure with respect to our database."""
        ...


# ── rendering helpers shared by adapters ────────────────────────────────────

#: Vault syntax that remote text must not be able to forge. An email whose
#: subject reads "#urgent" must not tag the user's vault, and one containing
#: "[[Roadmap]]" must not manufacture a link into their graph — sender-
#: controlled text reaching the tag pane and the graph is an injection, even
#: though it is a benign-looking one.
#:
#: The replacements are chosen against the real parsers in
#: `utils/markdown_parse`, not by intuition, and `test_provider_escaping`
#: asserts them against those parsers so a regex change there cannot silently
#: reopen this:
#:
#:   - `_WIKILINK_RE` needs two *adjacent* brackets, so `[\[` breaks it while
#:     still rendering as "[[" — markdown eats the backslash.
#:   - `_TAG_RE`'s lookbehind is `(?<![\w#])`, and a backslash is not a word
#:     character, so the obvious `\#` still parses as a tag. `&#35;` does not:
#:     it renders as "#" and leaves a digit where the parser needs a letter.
_ESCAPES = ((("[["), "[\\["), (("]]"), "]\\]"))
_HASH_TAG = re.compile(r"(?<![\w#])#(?=[\w/-]*[^\W\d])", re.UNICODE)


def escape_remote_text(text: str) -> str:
    """Neutralise vault syntax in text we did not write."""
    if not text:
        return ""
    for needle, replacement in _ESCAPES:
        text = text.replace(needle, replacement)
    return _HASH_TAG.sub("&#35;", text)


def split_user_region(content: str) -> tuple[str, str]:
    """Split a synced note into (sync-owned, user-owned).

    The user region includes the marker line itself, so a rewrite can
    concatenate the two halves back together unchanged.
    """
    index = content.find(f"\n{USER_REGION_MARKER}")
    if index == -1:
        if content.startswith(USER_REGION_MARKER):
            return "", content
        return content, ""
    return content[:index], content[index + 1 :]


def compose(sync_region: str, user_region: str) -> str:
    """Rebuild a note from its two halves, always leaving the marker in place."""
    head = sync_region.rstrip()
    tail = user_region.strip("\n")
    if not tail:
        tail = USER_REGION_MARKER
    return f"{head}\n\n{tail}\n"


def merge_into(existing: str, sync_region: str) -> str:
    """Replace only the sync-owned half of an existing note.

    Used as the callback to `note_service.transform_content`, which holds the
    row lock across it — so a person typing under `## Notes` at the moment a
    sync lands cannot lose the paragraph they are mid-way through.
    """
    _, user_region = split_user_region(existing)
    return compose(sync_region, user_region)
