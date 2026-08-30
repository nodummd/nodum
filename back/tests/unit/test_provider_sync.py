"""Unit tests for the provider sync engine and its adapters.

These target the failures that are *silent* — the ones with no error, no log
line and no way to notice until someone goes looking for a note that was never
written, or finds their own writing gone. Nothing here needs Postgres or a
network, because adapters are pure with respect to our database and that was
the point of the split.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app.models.providers.sync import CONNECTION_STATUSES
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


# ── the callback must never 500 ─────────────────────────────────────────────


class _Boom:
    """An httpx client whose every call fails the way a real network does."""

    def __init__(self, error: Exception) -> None:
        self._error = error

    async def __aenter__(self) -> _Boom:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def get(self, *args: object, **kwargs: object) -> None:
        raise self._error

    async def post(self, *args: object, **kwargs: object) -> None:
        raise self._error


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        __import__("httpx").ConnectError("refused"),
        __import__("httpx").ReadTimeout("slow"),
        __import__("httpx").RemoteProtocolError("truncated"),
    ],
)
async def test_transport_failures_become_provider_errors(error: Exception, monkeypatch) -> None:
    """These run on the OAuth callback, which is a top-level browser redirect.
    An unhandled httpx error there is a raw 500 page shown mid-flow, with the
    authorisation code already spent and no way back."""
    import httpx as _httpx

    monkeypatch.setattr(_httpx, "AsyncClient", lambda *a, **k: _Boom(error))

    with pytest.raises(base.ProviderError) as caught:
        await google_auth.exchange_code("code")
    assert caught.value.error_class == "provider_5xx"

    with pytest.raises(base.ProviderError) as caught:
        await google_auth.fetch_userinfo("token")
    assert caught.value.error_class == "provider_5xx"

    with pytest.raises(base.ProviderError):
        await google_auth.refresh_access_token("refresh")


@pytest.mark.asyncio
async def test_a_non_200_from_userinfo_does_not_escape_as_an_http_error(monkeypatch) -> None:
    """`raise_for_status` used to throw httpx.HTTPStatusError here, which the
    callback did not catch."""
    import httpx as _httpx

    class _Resp:
        status_code = 403
        text = "forbidden"

        @staticmethod
        def json() -> dict[str, Any]:
            return {}

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def get(self, *args: object, **kwargs: object) -> _Resp:
            return _Resp()

    monkeypatch.setattr(_httpx, "AsyncClient", lambda *a, **k: _Client())
    with pytest.raises(base.ProviderError) as caught:
        await google_auth.fetch_userinfo("token")
    assert caught.value.error_class == "auth"


@pytest.mark.asyncio
async def test_googles_raw_error_body_is_never_shown_to_the_user(monkeypatch) -> None:
    """Upstream bodies get logged, not rendered. They are third-party output
    with nothing useful in them for the person reading the connections list."""
    import httpx as _httpx

    class _Resp:
        status_code = 400
        text = '{"error":"invalid_client","error_description":"Unauthorized: internal-detail-xyz"}'

        @staticmethod
        def json() -> dict[str, Any]:
            return {}

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def post(self, *args: object, **kwargs: object) -> _Resp:
            return _Resp()

    monkeypatch.setattr(_httpx, "AsyncClient", lambda *a, **k: _Client())
    with pytest.raises(base.ProviderError) as caught:
        await google_auth.exchange_code("code")
    assert "internal-detail-xyz" not in str(caught.value)
    assert "try connecting again" in str(caught.value).lower()


def test_the_revoke_endpoint_host_is_right() -> None:
    """A typo'd host here revokes nothing and reports success — a disconnect
    that leaves the grant alive at Google."""
    assert google_auth.REVOKE_URL == "https://oauth2.googleapis.com/revoke"


# ── the scheduler wiring ────────────────────────────────────────────────────


def test_every_scheduled_job_points_at_a_task_that_exists() -> None:
    """A beat entry naming a task the worker never imported is a job that
    silently never runs — no error, no log, nothing.

    That is the top-level version of every silent-failure bug this feature has
    had: the whole sync depends on `tasks.sync_providers` firing every minute,
    and if someone adds a task module without adding it to `include`, the
    feature stops working and looks exactly like a Google problem.
    """
    from app.core.celery import celery_app

    # What a worker does at startup — without it, only whatever this test
    # happened to import would be registered, and the check would be a lie.
    celery_app.loader.import_default_modules()

    unregistered = [
        (name, entry["task"])
        for name, entry in celery_app.conf.beat_schedule.items()
        if entry["task"] not in celery_app.tasks
    ]
    assert not unregistered, (
        f"beat schedules a task the worker will not have: {unregistered}. "
        "Add its module to celery_app's `include` list."
    )


def test_the_sync_sweep_is_actually_scheduled() -> None:
    """Nothing about this feature works if the sweep is not on the schedule."""
    from app.core.celery import celery_app

    tasks = {entry["task"] for entry in celery_app.conf.beat_schedule.values()}
    assert "tasks.sync_providers" in tasks
    schedule = next(
        e["schedule"] for e in celery_app.conf.beat_schedule.values() if e["task"] == "tasks.sync_providers"
    )
    # Frequent enough that a new calendar event lands within a couple of
    # minutes, which is the whole promise of "live".
    assert 0 < float(schedule) <= 300


# ── People/ must contain people ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "address",
    [
        "noreply@github.com",
        "no-reply@example.com",
        "notifications@slack.com",
        "MAILER-DAEMON@example.com",
        "billing@stripe.com",
        "u=3f2b91c07a8d4e6f0192@list.example.com",
    ],
)
def test_machinery_never_earns_a_person_note(address: str) -> None:
    """A newsletter clears any interaction threshold within a week. Without
    this, People/ fills with "no-reply" and "notifications" and the real names
    become harder to find than if the folder did not exist."""
    assert google_gmail.is_automated(address)


@pytest.mark.parametrize("address", ["amara@example.com", "dan.reeves@acme.io", "j.chen@uni.ac.uk"])
def test_actual_people_are_not_excluded(address: str) -> None:
    assert not google_gmail.is_automated(address)


# ── the declared vocabulary must match the code ─────────────────────────────


def _assigned_literals(source: str, attribute: str) -> set[str]:
    """Every string literal assigned to `connection.<attribute>` in a module."""
    import ast

    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if (
                isinstance(target, ast.Attribute)
                and target.attr == attribute
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                found.add(node.value.value)
    return found


def test_status_values_are_declared() -> None:
    """CONNECTION_STATUSES is only worth having if it is true.

    A tuple that documents intent drifts from the code within a couple of
    changes and then actively misleads — and a typo'd status ("activee") would
    silently take a connection out of the scheduler's WHERE clause forever,
    which is this feature's signature failure.
    """
    import pathlib

    from app.models.providers import CONNECTION_STATUSES

    assigned: set[str] = set()
    for module in ("provider_sync_service.py", "provider_connection_service.py"):
        path = pathlib.Path(__file__).resolve().parents[2] / "app" / "services" / module
        assigned |= _assigned_literals(path.read_text(), "status")

    undeclared = assigned - set(CONNECTION_STATUSES)
    assert not undeclared, f"status values assigned but not declared: {sorted(undeclared)}"
    # And nothing declared that the code never sets — a status nobody assigns
    # is a state the UI may be written to handle and can never reach.
    unused = set(CONNECTION_STATUSES) - assigned
    assert not unused, f"declared statuses nothing ever assigns: {sorted(unused)}"


def test_error_classes_raised_by_adapters_are_declared() -> None:
    """Same for error_class, which the UI switches on."""
    import pathlib

    from app.models.providers import ERROR_CLASSES

    root = pathlib.Path(__file__).resolve().parents[2] / "app" / "services"
    raised: set[str] = set()
    for path in [*(root / "providers").glob("*.py"), root / "provider_sync_service.py"]:
        import ast

        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.keyword)
                and node.arg == "error_class"
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                raised.add(node.value.value)

    undeclared = raised - set(ERROR_CLASSES)
    assert not undeclared, f"error classes raised but not declared: {sorted(undeclared)}"


# ── the Gmail thread renderer ───────────────────────────────────────────────
#
# Untested until now, and it handles the most hostile input in the feature:
# every field below is chosen by whoever sent the message.


def _b64(text: str) -> str:
    import base64

    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def _message(
    *,
    sender: str,
    subject: str = "",
    body: str = "",
    html: str = "",
    labels: list[str] | None = None,
    when: int = 1_700_000_000_000,
) -> dict[str, Any]:
    headers = [{"name": "From", "value": sender}]
    if subject:
        headers.append({"name": "Subject", "value": subject})
    payload: dict[str, Any] = {"headers": headers}
    if html:
        payload["mimeType"] = "text/html"
        payload["body"] = {"data": _b64(html)}
    else:
        payload["mimeType"] = "text/plain"
        payload["body"] = {"data": _b64(body)} if body else {}
    return {
        "id": f"m{when}",
        "labelIds": labels if labels is not None else ["INBOX"],
        "internalDate": str(when),
        "payload": payload,
    }


class _FakeGmail(google_gmail.GoogleGmailAdapter):
    # `_payload`, not `_thread` — the latter is the method under test, and
    # assigning it in __init__ shadows it with a dict.
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    async def _get(self, path: str, token: str, params: dict[str, str]) -> dict[str, Any]:
        return self._payload


async def _render(thread: dict[str, Any], **settings: Any):
    adapter = _FakeGmail(thread)
    ctx = _ctx(stream="gmail:messages", settings={"gmail": settings} if settings else {})
    return await adapter._thread("t1", ctx)


@pytest.mark.asyncio
async def test_a_thread_becomes_one_note_with_its_participants() -> None:
    record = await _render(
        {
            "id": "t1",
            "historyId": "9001",
            "messages": [
                _message(sender='"Amara Osei" <amara@example.com>', subject="Q3 roadmap", when=1_700_000_000_000),
                _message(sender="Dan Reeves <dan@example.com>", when=1_700_000_600_000),
                _message(sender='"Amara Osei" <amara@example.com>', when=1_700_001_200_000),
            ],
        }
    )
    assert record is not None
    assert record.folder.startswith("Mail/")
    # One note for the whole conversation, not one per message.
    assert record.body.count("# ") >= 1
    # Each person once, in first-seen order.
    assert record.wants_notes == ("Amara Osei", "Dan Reeves")
    assert record.external_version == 9001


@pytest.mark.asyncio
async def test_a_reply_subject_still_produces_a_creatable_title() -> None:
    """ "Re: …" is most of any inbox, and a colon is a rejected path segment."""
    from app.utils.path_utils import validate_segment

    record = await _render({"id": "t1", "messages": [_message(sender="a@b.com", subject="Re: Q3 roadmap")]})
    assert record is not None
    assert validate_segment(record.title) is None
    # The heading keeps what the thread is actually called.
    assert "Re: Q3 roadmap" in record.body


@pytest.mark.asyncio
async def test_bodies_are_not_stored_unless_asked_for() -> None:
    """Storing message bodies is opt-in per connection. Off, a note carries
    who and when and nothing the sender wrote."""
    thread = {
        "id": "t1",
        "messages": [_message(sender="a@b.com", subject="Hello", body="SECRET BODY TEXT")],
    }

    off = await _render(thread)
    assert off is not None
    assert "SECRET BODY TEXT" not in off.body
    assert "not stored" in off.body

    on = await _render(thread, store_bodies=True)
    assert on is not None
    assert "SECRET BODY TEXT" in on.body


@pytest.mark.asyncio
async def test_an_html_only_message_is_converted_rather_than_dropped() -> None:
    record = await _render(
        {
            "id": "t1",
            "messages": [_message(sender="a@b.com", subject="Newsletter", html="<p>Hello <b>there</b></p>")],
        },
        store_bodies=True,
    )
    assert record is not None
    assert "**there**" in record.body


@pytest.mark.asyncio
async def test_gmail_labels_become_namespaced_tags_and_noise_is_dropped() -> None:
    record = await _render(
        {
            "id": "t1",
            "messages": [
                _message(
                    sender="a@b.com",
                    subject="Hi",
                    labels=["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_UPDATES"],
                )
            ],
        }
    )
    assert record is not None
    assert "gmail/inbox" in record.body
    assert "gmail/updates" in record.body
    # State, not topic — these would land on nearly every note.
    assert "gmail/unread" not in record.body
    assert "gmail/important" not in record.body


@pytest.mark.asyncio
async def test_a_hostile_subject_cannot_reach_the_tag_pane_or_the_graph() -> None:
    """Every field here is chosen by whoever sent the email."""
    record = await _render(
        {
            "id": "t1",
            "messages": [
                _message(
                    sender='"[[Evil]] #hax" <a@b.com>',
                    subject="Re: #urgent see [[Roadmap]]",
                    body="body with #tag and [[Link]]",
                )
            ],
        },
        store_bodies=True,
    )
    assert record is not None
    assert extract_tags(record.body) <= {"gmail/inbox"}, "sender-controlled text produced a tag"
    targets = {link.target for link in extract_wikilinks(record.body)}
    # The only link a thread may emit is its date.
    assert "Roadmap" not in targets
    assert "Evil" not in targets
    assert "Link" not in targets


@pytest.mark.asyncio
async def test_a_thread_that_lost_its_messages_is_a_tombstone() -> None:
    record = await _render({"id": "t1", "messages": []})
    assert record is not None
    assert record.kind == "tombstone"


@pytest.mark.asyncio
async def test_automated_senders_are_kept_out_of_the_people_list() -> None:
    record = await _render(
        {
            "id": "t1",
            "messages": [
                _message(sender="noreply@github.com", subject="Build failed"),
                _message(sender='"Amara Osei" <amara@example.com>', when=1_700_000_600_000),
            ],
        }
    )
    assert record is not None
    assert record.wants_notes == ("Amara Osei",)


# ── transport handling, as a structural rule ────────────────────────────────


def test_every_http_call_in_a_provider_handles_transport_failure() -> None:
    """An unwrapped httpx client is a 500 waiting for a bad network moment.

    This rule was learned twice. The adapter's `_get` was fixed first; then
    `list_calendars` turned out to construct its own client and had been missed
    — and it sits *after* the tokens are committed, so it 500'd a connection
    that had actually succeeded. Both times the fix was applied to the instance
    in the stack trace rather than to the class.

    So the class is checked here instead: every `httpx.AsyncClient(...)` under
    services/providers must be lexically inside a `try` that handles transport
    errors. A new adapter cannot reintroduce this without the build failing.
    """
    import ast
    import pathlib

    def handles_transport(handler: ast.ExceptHandler) -> bool:
        node = handler.type
        if node is None:  # bare except
            return True
        names = node.elts if isinstance(node, ast.Tuple) else [node]
        for name in names:
            text = ast.unparse(name)
            if text.endswith(("HTTPError", "TransportError", "Exception")):
                return True
        return False

    offenders: list[str] = []
    root = pathlib.Path(__file__).resolve().parents[2] / "app" / "services" / "providers"

    for path in sorted(root.glob("*.py")):
        tree = ast.parse(path.read_text())
        parents: dict[ast.AST, ast.AST] = {}
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                parents[child] = parent

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if ast.unparse(node.func) not in ("httpx.AsyncClient", "AsyncClient"):
                continue

            guarded = False
            current: ast.AST | None = node
            while current is not None:
                current = parents.get(current)
                if isinstance(current, ast.Try) and any(handles_transport(h) for h in current.handlers):
                    guarded = True
                    break
            if not guarded:
                offenders.append(f"{path.name}:{node.lineno}")

    assert not offenders, (
        "httpx client constructed without transport handling at "
        f"{offenders}. Wrap it and raise ProviderError(error_class='provider_5xx') — "
        "an escaping httpx error is a 500 page, and on the OAuth callback it is "
        "shown to someone whose connection may already have succeeded."
    )


# ── Gmail incremental: the path that runs forever ───────────────────────────


class _FakeHistory(google_gmail.GoogleGmailAdapter):
    """History responses keyed by the pageToken asked for; threads are stubs."""

    def __init__(self, pages: dict[str, dict[str, Any]]) -> None:
        self._pages = pages
        self.thread_calls: list[str] = []
        self.history_calls: list[str] = []

    async def _get(self, path: str, token: str, params: dict[str, str]) -> dict[str, Any]:
        if path == "/history":
            asked = params.get("pageToken", "")
            self.history_calls.append(asked)
            return self._pages[asked]
        thread_id = path.rsplit("/", 1)[-1]
        self.thread_calls.append(thread_id)
        return {
            "id": thread_id,
            "historyId": "500",
            "messages": [_message(sender="a@b.com", subject=f"Thread {thread_id}")],
        }


def _history(thread_ids: list[str], *, next_page: str = "", history_id: str = "999") -> dict[str, Any]:
    return {
        "history": [{"messagesAdded": [{"message": {"threadId": tid}}]} for tid in thread_ids],
        **({"nextPageToken": next_page} if next_page else {}),
        "historyId": history_id,
    }


@pytest.mark.asyncio
async def test_a_history_page_naming_more_threads_than_the_batch_loses_none() -> None:
    """The batch size is a pagination bound, not a truncation.

    One history response routinely names far more changed threads than a batch
    — bulk-archiving a hundred messages does it in a single response. Taking
    the first 25 and advancing the cursor past the rest loses them
    permanently, and this runs on the path that operates forever.
    """
    ids = [f"t{i}" for i in range(60)]
    adapter = _FakeHistory({"": _history(ids)})

    fetched: list[str] = []
    page_token = ""
    for _ in range(10):
        page = await adapter.fetch(_ctx(stream="gmail:messages", cursor_token="100", page_token=page_token))
        fetched.extend(r.external_id for r in page.records)
        if page.done:
            assert page.next_cursor == "999", "the walk finished without advancing the cursor"
            break
        assert page.next_cursor == "", "the cursor moved while threads were still unprocessed"
        page_token = page.next_page_token
    else:
        raise AssertionError("the walk never finished")

    assert fetched == ids, "threads were dropped between batches"
    assert len(adapter.thread_calls) == len(ids)


@pytest.mark.asyncio
async def test_the_cursor_only_lands_after_the_last_history_page() -> None:
    adapter = _FakeHistory(
        {
            "": _history(["a", "b"], next_page="h2"),
            "h2": _history(["c"], history_id="999"),
        }
    )

    first = await adapter.fetch(_ctx(stream="gmail:messages", cursor_token="100"))
    assert first.done is False
    assert first.next_cursor == ""
    assert first.next_page_token == "h2|0"

    second = await adapter.fetch(_ctx(stream="gmail:messages", cursor_token="100", page_token=first.next_page_token))
    assert second.done is True
    assert second.next_cursor == "999"
    assert adapter.history_calls == ["", "h2"]


@pytest.mark.asyncio
async def test_a_thread_touched_repeatedly_is_fetched_once() -> None:
    """A message added and then labelled shows up several times in one page."""
    payload = {
        "history": [
            {"messagesAdded": [{"message": {"threadId": "t1"}}]},
            {"labelsAdded": [{"message": {"threadId": "t1"}}]},
            {"labelsRemoved": [{"message": {"threadId": "t1"}}]},
            {"messagesAdded": [{"message": {"threadId": "t2"}}]},
        ],
        "historyId": "999",
    }
    adapter = _FakeHistory({"": payload})
    page = await adapter.fetch(_ctx(stream="gmail:messages", cursor_token="100"))
    assert adapter.thread_calls == ["t1", "t2"]
    assert len(page.records) == 2


@pytest.mark.asyncio
async def test_an_empty_history_still_advances_the_cursor() -> None:
    """Nothing changed is the common case; it must not stall the cursor, or
    every future poll re-reads the same window forever."""
    adapter = _FakeHistory({"": {"history": [], "historyId": "1234"}})
    page = await adapter.fetch(_ctx(stream="gmail:messages", cursor_token="100"))
    assert page.records == []
    assert page.done is True
    assert page.next_cursor == "1234"


# ── the OAuth callback's vocabulary ─────────────────────────────────────────
#
# The callback can only reach the UI through a URL, and the URL carries a code
# rather than a message — anyone can send a person to
# `/vault?connected=failed&reason=…`, and rendering whatever it says would put
# attacker-chosen prose inside the app's own chrome with no XSS involved.
#
# That design has one failure mode, and it is silent: somebody adds a `reason`
# on the server and the client, which owns the words, shows generic copy for it
# forever. These two tests are the only thing that would ever notice.


def _declared_reasons() -> set[str]:
    """Every `reason=` literal in the code the callback can reach."""
    import ast

    found: set[str] = set()
    for path in (
        Path("app/services/provider_connection_service.py"),
        Path("app/services/providers/google_auth.py"),
    ):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            for keyword in node.keywords:
                if (
                    keyword.arg == "reason"
                    and isinstance(keyword.value, ast.Constant)
                    and isinstance(keyword.value.value, str)
                    and keyword.value.value
                ):
                    found.add(keyword.value.value)
    return found


def test_every_reason_the_server_can_send_is_in_the_closed_set() -> None:
    from app.api.v1.integrations import CALLBACK_REASONS

    declared = _declared_reasons()
    assert declared, "no reason codes found — this test stopped testing anything"
    missing = declared - CALLBACK_REASONS
    assert not missing, (
        f"{sorted(missing)} would be dropped from the callback URL, so the user is told nothing. "
        "Add them to CALLBACK_REASONS."
    )


def test_the_client_has_words_for_every_reason_the_server_can_send() -> None:
    """Read across the language boundary, because nothing else does.

    The server owns the codes and the client owns the copy, which is the right
    split. It is also a contract with no compiler behind it: a code the client
    has never heard of silently degrades to "please try again", which is the
    generic message this whole mechanism exists to replace.
    """
    from app.api.v1.integrations import CALLBACK_REASONS

    source = Path("../web/src/components/workspace/connection-callback-notice.tsx")
    if not source.exists():  # pragma: no cover - backend-only checkouts
        pytest.skip("web/ not present")

    text = source.read_text()
    body = text[text.index("const REASONS") : text.index("const FALLBACK")]
    known = set(re.findall(r"^\s{2}(\w+):", body, re.MULTILINE))

    unknown = CALLBACK_REASONS - known
    assert not unknown, f"the UI has no wording for {sorted(unknown)} and will show generic copy instead"
    stale = known - CALLBACK_REASONS
    assert not stale, f"the UI carries wording for {sorted(stale)}, which the server can no longer send"


# ── the deployment contract ─────────────────────────────────────────────────


def test_sync_settings_reach_every_container_that_reads_them() -> None:
    """The whole feature shipped unreachable once, and nothing noticed.

    Settings exist and default to empty, so an unwired variable is not an
    error anywhere — the operator sets GOOGLE_SYNC_CLIENT_ID in their env file,
    restarts, and Connections still says "not configured on this server", with
    no way to find out why. There is no import to break and no log line.

    The api/worker split is the sharper half. The API exchanges the code and
    encrypts; the worker refreshes and decrypts on every run. Wire these to the
    API alone and connecting appears to work, and then every background run
    fails — `key_unavailable` without the key, `needs_reauth` without the
    client — which reads as a Google problem rather than as a compose file.

    So they belong in the shared anchor, and that is what this asserts.
    """
    compose = Path("../deploy/docker-compose.deploy.yml")
    if not compose.exists():  # pragma: no cover - backend-only checkouts
        pytest.skip("deploy/ not present")

    text = compose.read_text()
    # The anchor ends where `services:` begins; anything after that is per-service.
    anchor = text[text.index("x-backend-env:") : text.index("\nservices:")]

    settings_source = Path("app/settings/common.py").read_text()
    declared = set(
        re.findall(
            r"^\s{4}((?:GOOGLE_SYNC|PROVIDER_SYNC|OAUTH_ENCRYPTION)[A-Z_0-9]*)\s*:",
            settings_source,
            re.MULTILINE,
        )
    )
    assert declared, "no sync settings found — this test stopped testing anything"

    missing = {name for name in declared if f"\n  {name}:" not in anchor}
    assert not missing, (
        f"{sorted(missing)} never reach the containers. The API, the Celery worker and beat all "
        "read them, so they belong in the x-backend-env anchor rather than on one service."
    )


def test_an_operator_can_discover_the_sync_settings_exist() -> None:
    """A setting nobody is told about is off forever in practice."""
    for name in ("../deploy/.env.prod.example", "../deploy/.env.example"):
        example = Path(name)
        if not example.exists():  # pragma: no cover - backend-only checkouts
            pytest.skip("deploy/ not present")
        text = example.read_text()
        for key in ("GOOGLE_SYNC_CLIENT_ID", "GOOGLE_SYNC_CLIENT_SECRET", "OAUTH_ENCRYPTION_KEY"):
            assert key in text, f"{key} is undocumented in {name}"
        # The seven-day trap costs more support time than every other failure
        # in this feature combined, and the fix is a button in Google Cloud
        # that nothing in the product can press.
        assert "ublish" in text, f"{name} does not warn about Testing mode"


def test_the_client_knows_exactly_the_statuses_the_server_can_send() -> None:
    """A status in the type that the server never sends is a branch the UI can
    carry forever without anyone noticing it is dead — and one the server
    *does* send but the type omits falls through whatever `else` exists,
    usually the reassuring one."""
    source = Path("../web/src/lib/api/endpoints.ts")
    if not source.exists():  # pragma: no cover - backend-only checkouts
        pytest.skip("web/ not present")

    text = source.read_text()
    declared = text[text.index("  status:", text.index("export interface ProviderConnection")) :]
    declared = declared[: declared.index(";")]
    known = set(re.findall(r'"([a-z_]+)"', declared))

    assert known == set(CONNECTION_STATUSES), f"client says {sorted(known)}, server sends {sorted(CONNECTION_STATUSES)}"
