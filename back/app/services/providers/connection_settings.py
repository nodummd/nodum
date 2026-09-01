"""What a user may put in a connection's settings, and what the engine reads back.

`PATCH /connections/{id}` is the only place a person writes into the sync
engine's own configuration, and every run reads that blob back. Allowlisting
the *keys* — which is all this did — is not enough, because the damage lives in
the values:

- ``people_threshold: "soon"`` makes ``int()`` raise inside ``apply_record``,
  on every poll, forever: a permanently dead connection created through a
  documented API, with no way back through the UI.
- ``calendar_ids`` holding five thousand entries becomes five thousand stream
  rows, each on its own poll timer. That is a quota burn that takes the whole
  instance's Google access down with it, not just the account that asked.
- ``calendar_ids: ["primary", "primary"]`` asks ``ensure_streams`` to insert
  the same stream twice in one flush.
- ``calendar_ids: "primary"`` is a string, so iterating it yields *characters*
  and creates a stream per letter.
- ``folder_root: "../.."`` is prepended raw to every note path.
- ``people_threshold: 0`` links every correspondent who ever appears, which is
  exactly the ghost-node flood the threshold exists to prevent.

So values are validated here, at the boundary, and refused with a message that
names the field. The readers at the bottom are total on top of that: a blob
stored before this module existed, or written by some future path that forgets
to come through ``clean``, still must not be able to kill a run. Validation
decides what a user may *say*; the readers decide what the engine *does*, and
the engine never trusts its own database that much.
"""

from __future__ import annotations

from typing import Any

from app.services.importers.base import safe_segment

#: A person has a handful of calendars, not hundreds; the bound is about what
#: an attacker can make the poller do, so it sits just above real use.
MAX_CALENDARS = 25
MAX_LABELS = 25
#: Enough to blocklist every newsletter anyone really has; a bound because an
#: unbounded list is scanned per message, per thread, forever.
MAX_EXCLUDE_SENDERS = 50
#: Ten years. Google will not return more usefully, and the number only ever
#: widens the first walk.
MAX_BACKFILL_DAYS = 3650
MAX_PEOPLE_THRESHOLD = 1000
MAX_FOLDER_ROOT = 120
MAX_ID_LENGTH = 255

DEFAULT_PEOPLE_THRESHOLD = 3
DEFAULT_BACKFILL_DAYS = 365


class InvalidSetting(ValueError):
    """A rejected value. The message is shown to the user, so it names the field."""


# ── validation: what may be written ─────────────────────────────────────────


def _whole_number(value: Any, *, name: str, low: int, high: int) -> int:
    # `bool` is an `int` subclass, and `True` reaching a threshold as 1 is a
    # confusing way to find out.
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidSetting(f"{name} must be a whole number between {low} and {high}.")
    if not low <= value <= high:
        raise InvalidSetting(f"{name} must be between {low} and {high}.")
    return value


def _identifiers(value: Any, *, name: str, limit: int) -> list[str]:
    if not isinstance(value, list):
        raise InvalidSetting(f"{name} must be a list.")
    if len(value) > limit:
        raise InvalidSetting(f"{name} can hold at most {limit} entries.")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise InvalidSetting(f"Every entry in {name} must be a non-empty string.")
        cleaned = item.strip()
        if len(cleaned) > MAX_ID_LENGTH:
            raise InvalidSetting(f"An entry in {name} is too long.")
        # Deduplicated here rather than in the engine: two identical ids are
        # two rows with the same primary key, one flush apart.
        if cleaned not in out:
            out.append(cleaned)
    return out


def _folder_root(value: Any) -> str:
    if not isinstance(value, str):
        raise InvalidSetting("folder_root must be text.")
    cleaned = _sanitise_root(value)
    if value.strip() and not cleaned:
        raise InvalidSetting("folder_root has no usable characters in it.")
    if len(cleaned) > MAX_FOLDER_ROOT:
        raise InvalidSetting(f"folder_root must be shorter than {MAX_FOLDER_ROOT} characters.")
    return cleaned


def _sanitise_root(value: str) -> str:
    """Run a folder prefix through the vault's own path rules.

    `safe_segment` maps `.` and `..` to its fallback, so traversal collapses
    to nothing rather than to a folder named `..`.
    """
    segments = (safe_segment(part, fallback="") for part in value.split("/"))
    return "/".join(part for part in segments if part)


def _section(patch: dict[str, Any], key: str) -> dict[str, Any]:
    value = patch.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise InvalidSetting(f"{key} settings must be an object.")
    return value


def clean(patch: dict[str, Any]) -> dict[str, Any]:
    """The subset of `patch` a user is allowed to store, validated.

    Unknown keys are dropped rather than refused, so a client one version ahead
    does not get a 422 for a field this server has not learned yet.

    Raises `InvalidSetting`, whose message is safe to show.
    """
    if not isinstance(patch, dict):
        raise InvalidSetting("Settings must be an object.")

    out: dict[str, Any] = {}

    if "folder_root" in patch:
        out["folder_root"] = _folder_root(patch["folder_root"])
    if "people_threshold" in patch:
        out["people_threshold"] = _whole_number(
            patch["people_threshold"], name="people_threshold", low=1, high=MAX_PEOPLE_THRESHOLD
        )

    for key in ("link_daily", "link_people"):
        if key in patch:
            if not isinstance(patch[key], bool):
                raise InvalidSetting(f"{key} must be true or false.")
            out[key] = patch[key]

    calendar = _section(patch, "calendar")
    cleaned_calendar: dict[str, Any] = {}
    if "calendar_ids" in calendar:
        cleaned_calendar["calendar_ids"] = _identifiers(
            calendar["calendar_ids"], name="calendar_ids", limit=MAX_CALENDARS
        )
    if "backfill_days" in calendar:
        # 0 is a real choice: "future only" — no history walk at all.
        cleaned_calendar["backfill_days"] = _whole_number(
            calendar["backfill_days"], name="backfill_days", low=0, high=MAX_BACKFILL_DAYS
        )
    if "calendar" in patch:
        out["calendar"] = cleaned_calendar

    gmail = _section(patch, "gmail")
    cleaned_gmail: dict[str, Any] = {}
    if "labels" in gmail:
        cleaned_gmail["labels"] = _identifiers(gmail["labels"], name="labels", limit=MAX_LABELS)
    if "backfill_days" in gmail:
        cleaned_gmail["backfill_days"] = _whole_number(
            gmail["backfill_days"], name="backfill_days", low=0, high=MAX_BACKFILL_DAYS
        )
    if "store_bodies" in gmail:
        if not isinstance(gmail["store_bodies"], bool):
            raise InvalidSetting("store_bodies must be true or false.")
        cleaned_gmail["store_bodies"] = gmail["store_bodies"]
    if "exclude_senders" in gmail:
        # Lowercased BEFORE deduplication — addresses are case-insensitive, and
        # "Noreply@Shop.com" surviving next to "noreply@shop.com" is the same
        # entry twice.
        lowered: list[str] = []
        for entry in _identifiers(gmail["exclude_senders"], name="exclude_senders", limit=MAX_EXCLUDE_SENDERS):
            candidate = entry.lower()
            if candidate not in lowered:
                lowered.append(candidate)
        cleaned_gmail["exclude_senders"] = lowered
    if "gmail" in patch:
        out["gmail"] = cleaned_gmail

    return out


# ── reading: what the engine does with it ───────────────────────────────────
#
# None of these raise. A stored value the engine cannot make sense of falls
# back to the default, because the alternative is an exception on a background
# poll where nobody is watching.


def _coerce_int(value: Any, *, default: int, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    # Below the floor is nonsense and falls back; above the ceiling is intent
    # with the volume too high, and clamps. The floor is 0 where "none at all"
    # is a real choice (backfill) and 1 where it is the flood the bound exists
    # to prevent (people_threshold).
    if number < low:
        return default
    return min(high, number)


def people_threshold(settings: dict[str, Any] | None) -> int:
    return _coerce_int(
        (settings or {}).get("people_threshold"),
        default=DEFAULT_PEOPLE_THRESHOLD,
        low=1,
        high=MAX_PEOPLE_THRESHOLD,
    )


def folder_root(settings: dict[str, Any] | None) -> str:
    value = (settings or {}).get("folder_root")
    return _sanitise_root(value) if isinstance(value, str) else ""


def backfill_days(settings: dict[str, Any] | None, section: str, default: int) -> int:
    block = (settings or {}).get(section)
    raw = block.get("backfill_days") if isinstance(block, dict) else None
    return _coerce_int(raw, default=default, low=0, high=MAX_BACKFILL_DAYS)


def identifiers(
    settings: dict[str, Any] | None, section: str, key: str, *, default: list[str], limit: int
) -> list[str]:
    """A list of remote ids, or the default. Never a string iterated by letter."""
    block = (settings or {}).get(section)
    raw = block.get(key) if isinstance(block, dict) else None
    if not isinstance(raw, list):
        return list(default)
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip() and item.strip() not in out:
            out.append(item.strip()[:MAX_ID_LENGTH])
    return out[:limit] or list(default)


def link_daily(settings: dict[str, Any] | None) -> bool:
    """Emit the [[daily note]] wikilink? Default yes — it is the single most
    valuable connection this feature makes — but a link is still the user's
    graph, and some people keep their daily notes out of it on purpose."""
    value = (settings or {}).get("link_daily")
    return value if isinstance(value, bool) else True


def link_people(settings: dict[str, Any] | None) -> bool:
    """Create People notes and link them? Off means names stay plain text."""
    value = (settings or {}).get("link_people")
    return value if isinstance(value, bool) else True


def exclude_senders(settings: dict[str, Any] | None) -> list[str]:
    """Addresses or bare domains whose mail stays out of the vault entirely."""
    block = (settings or {}).get("gmail")
    raw = block.get("exclude_senders") if isinstance(block, dict) else None
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            cleaned = item.strip().lower()[:MAX_ID_LENGTH]
            if cleaned not in out:
                out.append(cleaned)
    return out[:MAX_EXCLUDE_SENDERS]


def store_bodies(settings: dict[str, Any] | None) -> bool:
    block = (settings or {}).get("gmail")
    return bool(block.get("store_bodies")) if isinstance(block, dict) else False
