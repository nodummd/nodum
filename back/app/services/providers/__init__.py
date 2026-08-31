"""Registry of data sources that sync into a vault.

## Read this before adding an adapter

Google sorts OAuth scopes into tiers, and the tier decides what a *hosted*
deployment owes:

- **Sensitive** (Calendar's read scopes) — a one-time verification review.
  Days of effort, no money. Shippable by anyone.
- **Restricted** (every Gmail scope, and Drive's broad ones) — a CASA security
  assessment by an authorised lab, renewed **every twelve months**, priced from
  several hundred to several thousand dollars a year, with the assurance level
  rising as your user count grows. An unfunded open-source project must not
  sign up to that.

So an adapter requesting a restricted scope may only ever run on a self-hosted
instance, where the operator uses their own Google Cloud project and is covered
by Google's personal-use exemption. That is what `requires_flag` encodes, and
`test_provider_scopes` fails the build if a restricted scope ever becomes
reachable without one.

The other half of the rule: this project must never ship OAuth client
credentials. The Google APIs Terms of Service forbid embedding developer
credentials in an open-source project, so `GOOGLE_SYNC_CLIENT_ID` and
`GOOGLE_SYNC_CLIENT_SECRET` are empty by default and a self-hoster registers
their own.
"""

from __future__ import annotations

from typing import Any

from app.settings import get_settings

from .base import (
    USER_REGION_MARKER,
    CursorInvalid,
    FetchContext,
    ProviderAdapter,
    ProviderError,
    SyncPage,
    SyncRecord,
    compose,
    escape_remote_text,
    has_user_region,
    merge_into,
    split_user_region,
    yaml_scalar,
)
from .google_calendar import GoogleCalendarAdapter
from .google_gmail import GoogleGmailAdapter


class _Entry:
    def __init__(self, adapter: Any, *, requires_flag: str = "", blurb: str = "", caveats: tuple[str, ...] = ()):
        self.adapter = adapter
        #: Settings flag that must be true for this adapter to be offered at
        #: all. Non-empty means "restricted scopes — self-hosted only".
        self.requires_flag = requires_flag
        self.blurb = blurb
        self.caveats = caveats

    @property
    def available(self) -> bool:
        if not self.requires_flag:
            return True
        return bool(getattr(get_settings(), self.requires_flag, False))


_REGISTRY: dict[str, _Entry] = {
    GoogleCalendarAdapter.id: _Entry(
        GoogleCalendarAdapter(),
        blurb="Events become notes on the day they happen, linked to your daily notes.",
        caveats=(
            "Read-only. Nodum never creates, edits or deletes anything in your calendar.",
            "One note per recurring series rather than one per occurrence, so a daily standup "
            "does not become a note every day.",
        ),
    ),
    GoogleGmailAdapter.id: _Entry(
        GoogleGmailAdapter(),
        requires_flag="GOOGLE_SYNC_GMAIL_ENABLED",
        blurb="Threads become notes, with participants and labels carried across.",
        caveats=(
            "Self-hosted only: Gmail's API scopes oblige a hosted service to pass a paid annual "
            "security audit, which this project does not carry.",
            "Read-only, and message bodies are only stored if you switch that on per connection.",
        ),
    ),
}


def available_adapters() -> list[Any]:
    return [entry.adapter for entry in _REGISTRY.values() if entry.available]


def get_adapter(adapter_id: str) -> Any | None:
    entry = _REGISTRY.get(adapter_id)
    return entry.adapter if entry and entry.available else None


def registry_entry(adapter_id: str) -> _Entry | None:
    return _REGISTRY.get(adapter_id)


def catalog() -> list[dict[str, Any]]:
    """What the connections UI renders."""
    return [
        {
            "id": entry.adapter.id,
            "name": entry.adapter.name,
            "blurb": entry.blurb,
            "caveats": list(entry.caveats),
            "scopes": list(entry.adapter.scopes),
            "available": entry.available,
            "self_hosted_only": bool(entry.requires_flag),
        }
        for entry in _REGISTRY.values()
    ]


__all__ = [
    "USER_REGION_MARKER",
    "CursorInvalid",
    "FetchContext",
    "GoogleCalendarAdapter",
    "GoogleGmailAdapter",
    "ProviderAdapter",
    "ProviderError",
    "SyncPage",
    "SyncRecord",
    "available_adapters",
    "catalog",
    "compose",
    "escape_remote_text",
    "get_adapter",
    "has_user_region",
    "merge_into",
    "registry_entry",
    "split_user_region",
    "yaml_scalar",
]
