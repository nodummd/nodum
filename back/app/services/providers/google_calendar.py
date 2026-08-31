"""Google Calendar → notes, one per event series.

Scopes are `calendar.events.readonly` and `calendar.calendarlist.readonly`,
both of which Google classes as *sensitive* rather than *restricted*. That
distinction is the whole reason Calendar can ship on a hosted instance and
Gmail cannot: sensitive means a one-time review, restricted means an annual
paid security assessment. `calendar.readonly` is deliberately not requested —
it is strictly broader for no benefit in a one-way sync, and a broader scope is
a harder justification at review time.

## Two decisions worth defending

**`singleEvents=false`.** Expanding recurrences produces one note per
occurrence, which for a daily standup is a note a day forever; and because
`timeMin`/`timeMax` are illegal alongside `syncToken` there is no cheap ceiling
on it. One note per *series* is both less noise and less work.

**`eventTypes=default`.** Without it, birthdays (effectively infinite
recurrence) and Gmail-derived events flood the vault. It is a frozen parameter,
so it has to be right on the very first call — changing it later invalidates
the sync token.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.services.daily_note_service import format_date
from app.services.importers.base import safe_segment

from . import connection_settings as settings_schema
from .base import CursorInvalid, FetchContext, ProviderError, SyncPage, SyncRecord, escape_remote_text

API = "https://www.googleapis.com/calendar/v3"

STREAM_PREFIX = "calendar:events:"
LIST_STREAM = "calendar:list"

#: Frozen with the sync token. Google invalidates a token when these change,
#: and does so without saying so — it returns a plausible partial result. The
#: engine compares this against the stored `cursor_params` and forces a resync
#: on any difference rather than trusting a call whose semantics are undefined.
QUERY_PARAMS = {"singleEvents": "false", "eventTypes": "default", "showDeleted": "true"}

DEFAULT_BACKFILL_DAYS = 365


class GoogleCalendarAdapter:
    id = "google_calendar"
    name = "Google Calendar"
    scopes = (
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    )

    def streams(self, connection_settings: dict[str, Any]) -> list[str]:
        """One stream per selected calendar — each has its own sync token.

        Putting all calendars behind one cursor would force every calendar to
        resync whenever any single one faulted.
        """
        calendars = settings_schema.identifiers(
            connection_settings, "calendar", "calendar_ids", default=["primary"], limit=settings_schema.MAX_CALENDARS
        )
        return [f"{STREAM_PREFIX}{cid}" for cid in calendars]

    def cursor_params(self, stream: str, settings: dict[str, Any]) -> dict[str, Any]:
        return dict(QUERY_PARAMS)

    async def fetch(self, ctx: FetchContext) -> SyncPage:
        calendar_id = ctx.stream[len(STREAM_PREFIX) :] or "primary"
        params: dict[str, str] = {**QUERY_PARAMS, "maxResults": "250"}

        if ctx.page_token:
            params["pageToken"] = ctx.page_token
            # A pageToken continues the walk the cursor started; re-sending the
            # syncToken alongside it is an error.
            if ctx.cursor_token and not ctx.backfill:
                params["syncToken"] = ctx.cursor_token
        elif ctx.cursor_token:
            params["syncToken"] = ctx.cursor_token
        else:
            # First walk only: bound the history. timeMin is illegal once a
            # syncToken exists, so this is the one chance to set it, and the
            # token that comes back is permanently bound to this window.
            days = settings_schema.backfill_days(ctx.settings, "calendar", DEFAULT_BACKFILL_DAYS)
            params["timeMin"] = (datetime.now(UTC) - timedelta(days=days)).isoformat()

        payload = await self._get(ctx.access_token, f"/calendars/{_quote(calendar_id)}/events", params)

        records: list[SyncRecord] = []
        for item in payload.get("items") or []:
            record = self._render(item, ctx, calendar_id)
            if record is not None:
                records.append(record)

        next_page = str(payload.get("nextPageToken") or "")
        next_sync = str(payload.get("nextSyncToken") or "")
        return SyncPage(
            records=records,
            next_page_token=next_page,
            # Only ever read on the final page. Google only sends it there, but
            # being explicit means a future refactor cannot promote a
            # mid-walk token and silently skip everything after it.
            next_cursor="" if next_page else next_sync,
            done=not next_page,
        )

    # ── rendering ────────────────────────────────────────────────────────

    def _render(self, item: dict[str, Any], ctx: FetchContext, calendar_id: str) -> SyncRecord | None:
        event_id = str(item.get("id") or "")
        if not event_id:
            return None

        # Cancellations first, because a cancelled event arrives with almost
        # nothing populated — often just an id and a status — and every field
        # access below would be None. A cancelled *instance* of a live
        # recurring series is not a deletion of the series, so it is dropped
        # rather than tombstoned; anything else is a real delete.
        if item.get("status") == "cancelled":
            if item.get("recurringEventId"):
                return None
            return SyncRecord(external_id=event_id, kind="tombstone")

        # A meeting you declined did not happen to you. Left in, it lands on
        # the day's note as though it did, and links you to people you never
        # met — which is worse than clutter in a graph whose whole value is
        # that its edges mean something.
        #
        # Dropped rather than tombstoned, like a cancelled instance of a live
        # series above: if you accepted and later declined, the note you took
        # is history and stays exactly as it is.
        if _declined_by_user(item):
            return None

        summary = escape_remote_text(str(item.get("summary") or "").strip()) or "(no title)"
        start_raw = (item.get("start") or {}).get("dateTime") or (item.get("start") or {}).get("date") or ""
        end_raw = (item.get("end") or {}).get("dateTime") or (item.get("end") or {}).get("date") or ""
        start_dt = _parse(start_raw)
        if start_dt is None:
            return None

        attendees = [a for a in (item.get("attendees") or []) if not a.get("resource")]
        names = [
            escape_remote_text(str(a.get("displayName") or (a.get("email") or "").split("@")[0]))
            for a in attendees
            if a.get("displayName") or a.get("email")
        ]
        names = [n for n in names if n][:20]

        day_link = format_date(ctx.daily_format, start_dt)
        recurrence = _describe_recurrence(item.get("recurrence") or [])

        front: list[str] = [
            "---",
            "source: google-calendar",
            "type: event",
            f"event_id: {event_id}",
            f"calendar: {escape_remote_text(calendar_id)}",
            f"start: {start_raw}",
            f"end: {end_raw}",
        ]
        if recurrence:
            front.append(f'recurrence: "{recurrence}"')
        if attendees:
            front.append(f"attendee_count: {len(attendees)}")
        if item.get("location"):
            front.append(f'location: "{escape_remote_text(str(item["location"]))[:200]}"')
        if item.get("htmlLink"):
            front.append(f"url: {item['htmlLink']}")
        front.append("---")

        lines = ["\n".join(front), "", f"# {summary}", ""]
        when = _time_range(start_raw, end_raw)
        # The date wikilink is the single most valuable connection this feature
        # makes — an event lands on the day you already journal into. It is
        # rendered with the vault's own daily-note format, because emitting
        # "Sep 2, 2026" into a vault that uses YYYY-MM-DD produces a ghost node
        # instead of a link.
        lines.append(f"[[{day_link}]]{when}")
        if names:
            lines.append("")
            lines.append(f"With {_people_sentence(names)}.")
        description = str(item.get("description") or "").strip()
        if description:
            lines.append("")
            lines.append(escape_remote_text(description[:4000]))

        updated = _parse(str(item.get("updated") or ""))
        return SyncRecord(
            external_id=event_id,
            # `create_note` *rejects* an illegal segment rather than repairing
            # it, and a calendar is full of them: "1:1 with Amara", "Design /
            # review", "Q3: planning". Unsanitised, those events silently never
            # sync and retry forever with nothing surfaced to the user. The
            # heading above still shows the real title — only the filename is
            # made safe.
            title=safe_segment(summary, fallback="Event"),
            folder=f"Calendar/{start_dt.strftime('%Y/%m')}",
            body="\n".join(lines).rstrip() + "\n",
            external_updated_at=updated,
            payload={"calendar_id": calendar_id, "start": start_raw},
            wants_notes=tuple(names),
        )

    async def _get(self, token: str, path: str, params: dict[str, str]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            # Transient by definition: classified so the connection backs off
            # and retries rather than being marked broken or killing the tick.
            raise ProviderError(
                f"Could not reach Google: {exc.__class__.__name__}", error_class="provider_5xx"
            ) from exc
        if resp.status_code == 410:
            # The documented "your sync token is too old" signal. Not an error
            # to retry — the only correct response is to discard the cursor and
            # walk from the beginning.
            raise CursorInvalid()
        if resp.status_code in (401, 403):
            raise ProviderError(resp.text[:200], error_class="auth")
        if resp.status_code == 429:
            raise ProviderError("Calendar rate limit", error_class="rate_limit", retry_after=60)
        if resp.status_code >= 500:
            raise ProviderError(f"Calendar returned {resp.status_code}", error_class="provider_5xx")
        if resp.status_code >= 400:
            raise ProviderError(f"Calendar returned {resp.status_code}: {resp.text[:200]}")
        return dict(resp.json())


async def list_calendars(access_token: str) -> list[dict[str, str]]:
    """Every calendar the grant can see, for the connection settings UI.

    Its own client, and therefore its own transport handling — the fix in the
    adapter's `_get` did not reach here. This runs on the OAuth callback
    *after* the tokens have been committed, so an unwrapped httpx error is a
    500 page shown to someone whose connection actually succeeded: they read it
    as failure and connect again.
    """
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{API}/users/me/calendarList",
                params={"maxResults": "250", "minAccessRole": "reader"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise ProviderError(f"Could not reach Google: {exc.__class__.__name__}", error_class="provider_5xx") from exc
    if resp.status_code >= 400:
        raise ProviderError(f"Could not list calendars: {resp.text[:200]}", error_class="auth")
    return [
        {
            "id": str(item.get("id") or ""),
            "name": str(item.get("summaryOverride") or item.get("summary") or item.get("id") or ""),
            "primary": bool(item.get("primary")),
        }
        for item in (resp.json().get("items") or [])
        if item.get("id")
    ]


# ── small helpers ───────────────────────────────────────────────────────────


def _quote(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _declined_by_user(item: dict[str, Any]) -> bool:
    """Did the account this connection belongs to decline?

    Only its own entry counts. Someone else declining is information about the
    meeting, not about whether it happened to you, and an event you organise
    has no attendee entry of your own at all.
    """
    for attendee in item.get("attendees") or []:
        if attendee.get("self") and str(attendee.get("responseStatus") or "") == "declined":
            return True
    return False


def _parse(raw: str) -> datetime | None:
    if not raw:
        return None
    text = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.fromisoformat(f"{text}T00:00:00+00:00")
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _time_range(start_raw: str, end_raw: str) -> str:
    """A rendered clock range for a timed event, or "" for an all-day one."""
    if "T" not in start_raw:
        return " · all day"
    start = _parse(start_raw)
    end = _parse(end_raw)
    if start is None:
        return ""
    if end is None:
        return f" {start.strftime('%H:%M')}"
    return f" {start.strftime('%H:%M')}\u2013{end.strftime('%H:%M')}"


def _people_sentence(names: list[str]) -> str:
    """Names as prose. The engine decides which become links."""
    if len(names) == 1:
        return names[0]
    if len(names) <= 4:
        return f"{', '.join(names[:-1])} and {names[-1]}"
    return f"{', '.join(names[:3])} and {len(names) - 3} others"


def _describe_recurrence(rules: list[str]) -> str:
    """A human phrase for an RRULE, without taking an iCalendar dependency."""
    for rule in rules:
        if not rule.upper().startswith("RRULE"):
            continue
        parts = dict(piece.split("=", 1) for piece in rule.split(":", 1)[-1].split(";") if "=" in piece)
        freq = (parts.get("FREQ") or "").lower()
        interval = parts.get("INTERVAL")
        if not freq:
            continue
        base = {"daily": "daily", "weekly": "weekly", "monthly": "monthly", "yearly": "yearly"}.get(freq, freq)
        return f"every {interval} {base}" if interval and interval != "1" else base
    return ""
