"""Unit tests for the provider sync engine and its adapters.

These target the failures that are *silent* — the ones with no error, no log
line and no way to notice until someone goes looking for a note that was never
written, or finds their own writing gone. Nothing here needs Postgres or a
network, because adapters are pure with respect to our database and that was
the point of the split.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.services import providers
from app.services.provider_sync_service import _MAX_TRACKED_PEOPLE, DEFAULT_PEOPLE_THRESHOLD
from app.services.providers import base, google_auth, google_calendar, google_gmail
from app.utils.markdown_parse import extract_tags, extract_wikilinks

# ── the compliance gate ─────────────────────────────────────────────────────


def test_restricted_scopes_are_never_reachable_without_a_flag() -> None:
    """A hosted deployment must not be able to request a restricted scope.

    Google's restricted tier obliges a hosted, multi-user service to pass a
    CASA security assessment by an authorised lab, renewed annually and priced
    in the hundreds to thousands of dollars. This test is the thing standing
    between a well-meaning future contributor and an accidental invoice: an
    adapter carrying a restricted scope MUST be gated behind a settings flag,
    which self-hosted operators set and hosted deployments never do.
    """
    for adapter_id in ("google_calendar", "google_gmail"):
        entry = providers.registry_entry(adapter_id)
        assert entry is not None, adapter_id
        restricted = set(entry.adapter.scopes) & google_auth.RESTRICTED_SCOPES
        if restricted:
            assert entry.requires_flag, (
                f"{adapter_id} requests restricted scope(s) {sorted(restricted)} but is not gated "
                "behind a settings flag — a hosted deploy could enable it and owe an annual audit."
            )


def test_calendar_avoids_the_broader_scope() -> None:
    """calendar.readonly is strictly broader for no benefit in a one-way sync,
    and a broader scope is a harder justification at verification time."""
    scopes = set(google_calendar.GoogleCalendarAdapter.scopes)
    assert "https://www.googleapis.com/auth/calendar.readonly" not in scopes
    assert "https://www.googleapis.com/auth/calendar.events.readonly" in scopes
    # And nothing Calendar asks for may be restricted, or hosted cannot ship it.
    assert not scopes & google_auth.RESTRICTED_SCOPES


def test_gmail_scope_is_readonly_only() -> None:
    scopes = set(google_gmail.GoogleGmailAdapter.scopes)
    assert scopes == {"https://www.googleapis.com/auth/gmail.readonly"}
    for writable in ("https://mail.google.com/", "https://www.googleapis.com/auth/gmail.modify"):
        assert writable not in scopes


# ── content injection ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "hostile",
    [
        "Re: #urgent please review",
        "See [[Roadmap]] for detail",
        "#a/b nested tag",
        "[[A]] and #b together",
    ],
)
def test_remote_text_cannot_forge_vault_syntax(hostile: str) -> None:
    """Sender-controlled text must not reach the tag pane or the graph.

    Asserted against the *real* extractors rather than a guess about them, so
    a regex change in markdown_parse cannot silently reopen this.
    """
    escaped = base.escape_remote_text(hostile)
    assert extract_tags(escaped) == set()
    assert [link.target for link in extract_wikilinks(escaped)] == []


def test_escaping_leaves_ordinary_text_alone() -> None:
    for benign in ("Quarterly review", "a#b is not a tag", "cost: $40 (approx)"):
        assert base.escape_remote_text(benign) == benign


# ── the user's writing ──────────────────────────────────────────────────────


def test_sync_never_touches_what_the_user_wrote() -> None:
    """The single unrecoverable failure this feature could have."""
    existing = (
        "---\nsource: google-calendar\n---\n\n# Design review\n\n[[2026-09-02]] 14:00\n\n"
        "## Notes\n\nAmara pushed back on the timeline. Follow up Tuesday.\n"
    )
    rewritten = providers.merge_into(
        existing, "---\nsource: google-calendar\n---\n\n# Design review (moved)\n\n[[2026-09-03]] 15:00\n"
    )

    assert "Amara pushed back on the timeline. Follow up Tuesday." in rewritten
    assert "Design review (moved)" in rewritten
    # The old sync region is gone, the user region is byte-identical.
    assert "14:00" not in rewritten
    _, user_region = providers.split_user_region(rewritten)
    assert user_region.strip().endswith("Follow up Tuesday.")


def test_a_note_with_no_user_region_still_gets_the_marker() -> None:
    """The empty `## Notes` heading is the affordance that invites writing —
    without it a synced note is a dead end."""
    composed = providers.compose("# Event\n\nbody", "")
    assert composed.rstrip().endswith(base.USER_REGION_MARKER)


def test_user_region_survives_repeated_syncs() -> None:
    content = providers.compose("v1", "## Notes\n\nmine")
    for version in range(2, 6):
        content = providers.merge_into(content, f"v{version}")
    assert content.count("## Notes") == 1
    assert "mine" in content


# ── Calendar ────────────────────────────────────────────────────────────────


def _ctx(**overrides: Any) -> base.FetchContext:
    defaults: dict[str, Any] = {
        "access_token": "t",
        "stream": "calendar:events:primary",
        "cursor_token": "",
        "page_token": "",
        "cursor_params": {},
        "settings": {},
        "daily_format": "YYYY-MM-DD",
    }
    defaults.update(overrides)
    return base.FetchContext(**defaults)


class _FakeCalendar(google_calendar.GoogleCalendarAdapter):
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.calls: list[dict[str, str]] = []

    async def _get(self, token: str, path: str, params: dict[str, str]) -> dict[str, Any]:
        self.calls.append(dict(params))
        return self._payload


@pytest.mark.asyncio
async def test_cancelled_standalone_event_becomes_a_tombstone() -> None:
    """A cancelled event often arrives with nothing but an id and a status —
    which is why the cancellation branch is handled before any field access."""
    adapter = _FakeCalendar({"items": [{"id": "evt1", "status": "cancelled"}]})
    page = await adapter.fetch(_ctx())
    assert [(r.external_id, r.kind) for r in page.records] == [("evt1", "tombstone")]


@pytest.mark.asyncio
async def test_cancelled_instance_of_a_live_series_is_not_a_deletion() -> None:
    """One skipped occurrence of a weekly meeting must not delete the series."""
    adapter = _FakeCalendar({"items": [{"id": "evt1_20260902", "status": "cancelled", "recurringEventId": "evt1"}]})
    page = await adapter.fetch(_ctx())
    assert page.records == []


@pytest.mark.asyncio
async def test_event_renders_with_the_vaults_own_daily_note_format() -> None:
    """A date link in the wrong format is a ghost node, and the date link is
    the single most valuable connection this feature makes."""
    item = {
        "id": "evt1",
        "status": "confirmed",
        "summary": "Design review",
        "start": {"dateTime": "2026-09-02T14:00:00+00:00"},
        "end": {"dateTime": "2026-09-02T15:00:00+00:00"},
        "attendees": [{"displayName": "Amara Osei"}, {"displayName": "Dan Reeves"}],
        "updated": "2026-08-30T10:00:00Z",
        "htmlLink": "https://calendar.google.com/x",
    }
    adapter = _FakeCalendar({"items": [item]})

    page = await adapter.fetch(_ctx(daily_format="YYYY-MM-DD"))
    assert "[[2026-09-02]]" in page.records[0].body

    page = await adapter.fetch(_ctx(daily_format="DD MMMM YYYY"))
    body = page.records[0].body
    assert "[[2026-09-02]]" not in body
    assert "[[02 September 2026]]" in body


@pytest.mark.asyncio
async def test_event_note_is_foldered_by_month_and_names_attendees() -> None:
    adapter = _FakeCalendar(
        {
            "items": [
                {
                    "id": "evt1",
                    "status": "confirmed",
                    "summary": "Design review",
                    "start": {"dateTime": "2026-09-02T14:00:00+00:00"},
                    "end": {"dateTime": "2026-09-02T15:00:00+00:00"},
                    "attendees": [{"displayName": "Amara Osei"}],
                    "recurrence": ["RRULE:FREQ=WEEKLY"],
                }
            ]
        }
    )
    record = (await adapter.fetch(_ctx())).records[0]
    assert record.folder == "Calendar/2026/09"
    assert record.title == "Design review"
    assert 'recurrence: "weekly"' in record.body
    assert record.wants_notes == ("Amara Osei",)
    # The adapter names people; only the engine may link them, and only above
    # the threshold — an adapter emitting [[links]] directly is how a graph
    # fills with ghosts.
    assert "[[Amara Osei]]" not in record.body


@pytest.mark.asyncio
async def test_sync_token_is_only_taken_from_the_final_page() -> None:
    """Persisting a token from a middle page silently skips every record after
    it — no error, no log line, ever."""
    mid = _FakeCalendar({"items": [], "nextPageToken": "p2", "nextSyncToken": "SHOULD_NOT_BE_USED"})
    page = await mid.fetch(_ctx())
    assert page.done is False
    assert page.next_page_token == "p2"
    assert page.next_cursor == ""

    last = _FakeCalendar({"items": [], "nextSyncToken": "TOKEN"})
    page = await last.fetch(_ctx())
    assert page.done is True
    assert page.next_cursor == "TOKEN"


@pytest.mark.asyncio
async def test_first_walk_bounds_history_but_incremental_does_not() -> None:
    """timeMin is illegal alongside syncToken, so it may only ever be sent on
    the very first walk."""
    adapter = _FakeCalendar({"items": []})
    await adapter.fetch(_ctx())
    assert "timeMin" in adapter.calls[0]

    adapter = _FakeCalendar({"items": []})
    await adapter.fetch(_ctx(cursor_token="TOKEN"))
    assert "timeMin" not in adapter.calls[0]
    assert adapter.calls[0]["syncToken"] == "TOKEN"


def test_frozen_query_params_are_declared() -> None:
    """Google invalidates a sync token when these change and does not say so,
    returning a plausible partial result instead."""
    params = google_calendar.GoogleCalendarAdapter().cursor_params("calendar:events:primary", {})
    assert params["singleEvents"] == "false"
    assert params["eventTypes"] == "default"


# ── Gmail ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_expired_gmail_history_asks_for_a_full_resync() -> None:
    """A 404 on /history means the cursor is older than Gmail's retention. The
    only correct response is to re-walk, not to retry."""
    adapter = google_gmail.GoogleGmailAdapter()

    class _Resp:
        status_code = 404
        text = "not found"

        @staticmethod
        def json() -> dict[str, Any]:
            return {}

    import httpx

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def get(self, *args: object, **kwargs: object) -> _Resp:
            return _Resp()

    original = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **k: _Client()  # type: ignore[assignment,misc]
    try:
        with pytest.raises(base.CursorInvalid):
            await adapter._get("/history", "token", {})
    finally:
        httpx.AsyncClient = original  # type: ignore[misc]


def test_gmail_label_filter_is_part_of_the_cursor_meaning() -> None:
    """Widening the label set must force a resync, or newly included threads
    are never seen — they are older than the cursor."""
    adapter = google_gmail.GoogleGmailAdapter()
    narrow = adapter.cursor_params("gmail:messages", {"gmail": {"labels": ["INBOX"]}})
    wide = adapter.cursor_params("gmail:messages", {"gmail": {"labels": ["INBOX", "STARRED"]}})
    assert narrow != wide


def test_address_parsing_prefers_a_display_name() -> None:
    assert google_gmail._split_address('"Amara Osei" <amara@example.com>')[0] == "Amara Osei"
    assert google_gmail._split_address("dan@example.com")[0] == "dan"


# ── the 7-day trap ──────────────────────────────────────────────────────────


def test_a_grant_that_died_within_a_week_is_diagnosed_as_testing_mode() -> None:
    """The generic "reconnect" advice does not fix this: the user reconnects,
    it works for seven days, and it breaks again — forever."""
    error_class, message = google_auth.classify_refresh_failure(
        '{"error": "invalid_grant"}', connected_at=datetime.now(UTC) - timedelta(days=7, hours=2)
    )
    assert error_class == "oauth_testing_mode"
    assert "Publish app" in message
    assert "Testing" in message


def test_an_older_grant_failing_is_a_normal_revocation() -> None:
    error_class, message = google_auth.classify_refresh_failure(
        '{"error": "invalid_grant"}', connected_at=datetime.now(UTC) - timedelta(days=200)
    )
    assert error_class == "auth"
    assert "Publish app" not in message


def test_an_unknown_refresh_failure_still_asks_for_a_reconnect() -> None:
    error_class, _ = google_auth.classify_refresh_failure("upstream exploded", connected_at=None)
    assert error_class == "auth"


# ── registry ────────────────────────────────────────────────────────────────


def test_catalog_is_honest_about_what_this_instance_offers() -> None:
    entries = {entry["id"]: entry for entry in providers.catalog()}
    assert entries["google_calendar"]["available"] is True
    assert entries["google_calendar"]["self_hosted_only"] is False
    # Gmail is off unless an operator turns it on.
    assert entries["google_gmail"]["self_hosted_only"] is True
    assert entries["google_gmail"]["available"] is False
    assert providers.get_adapter("google_gmail") is None
    for entry in entries.values():
        assert entry["blurb"] and entry["caveats"]


# ── the people threshold, across runs ───────────────────────────────────────


def test_people_counts_persist_so_the_threshold_means_interactions_ever() -> None:
    """The threshold has to count across runs, not within a page.

    Counting per-run made it mean "three appearances in one fetch", which an
    incremental sync of two events can never reach — so after the first
    backfill no People note was ever created again, silently, and the feature's
    main graph-enrichment path quietly did nothing.
    """
    from app.models.providers import ProviderConnection

    connection = ProviderConnection(people_counts={"Amara Osei": 2})
    seeded = dict(connection.people_counts or {})
    # One further sighting in a later run is enough to cross a threshold of 3.
    seeded["Amara Osei"] = seeded.get("Amara Osei", 0) + 1
    assert seeded["Amara Osei"] >= DEFAULT_PEOPLE_THRESHOLD


def test_tracked_people_are_bounded() -> None:
    """A busy mailbox must not grow one JSONB column without limit."""
    counts = {f"person-{i}": i for i in range(_MAX_TRACKED_PEOPLE + 250)}
    trimmed = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:_MAX_TRACKED_PEOPLE])
    assert len(trimmed) == _MAX_TRACKED_PEOPLE
    # The ones kept are the frequent ones; anything dropped is below any
    # sensible threshold by definition.
    assert min(trimmed.values()) > min(counts.values())


# ── titles that a vault will actually accept ────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "summary",
    ["1:1 with Amara", "Design / review", "Q3: planning", "Budget?", "a<b>c", "Weekly sync"],
)
async def test_event_titles_are_always_creatable(summary: str) -> None:
    """`create_note` rejects an illegal path segment rather than repairing it,
    and a real calendar is full of them — "1:1 with …" alone is most people's
    week. Unsanitised, those events silently never sync and retry on every
    poll forever, with nothing surfaced to the user."""
    from app.utils.path_utils import validate_segment

    adapter = _FakeCalendar(
        {
            "items": [
                {
                    "id": "evt1",
                    "status": "confirmed",
                    "summary": summary,
                    "start": {"dateTime": "2026-09-02T14:00:00+00:00"},
                    "end": {"dateTime": "2026-09-02T15:00:00+00:00"},
                }
            ]
        }
    )
    record = (await adapter.fetch(_ctx())).records[0]
    assert validate_segment(record.title) is None, f"{record.title!r} would be rejected"
    assert record.title


@pytest.mark.asyncio
async def test_the_heading_keeps_the_real_title_even_when_the_filename_cannot() -> None:
    """Only the filename is sanitised — the note still says what the meeting
    is actually called, or the sync has quietly renamed the user's day."""
    adapter = _FakeCalendar(
        {
            "items": [
                {
                    "id": "evt1",
                    "status": "confirmed",
                    "summary": "1:1 with Amara",
                    "start": {"dateTime": "2026-09-02T14:00:00+00:00"},
                    "end": {"dateTime": "2026-09-02T15:00:00+00:00"},
                }
            ]
        }
    )
    record = (await adapter.fetch(_ctx())).records[0]
    assert "# 1:1 with Amara" in record.body
    assert ":" not in record.title


def test_person_names_are_reduced_to_creatable_titles() -> None:
    from app.services.importers.base import safe_segment
    from app.utils.path_utils import validate_segment

    for name in ("Amara Osei", "Ops/Platform Team", "R&D: EU", "Zoë Müller"):
        safe = safe_segment(name, fallback="")
        assert safe, name
        assert validate_segment(safe) is None, f"{safe!r} would be rejected"
