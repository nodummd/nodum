"""The settings blob is user input that the sync engine reads as configuration.

Two separate obligations, tested separately:

- `clean` decides what a user may *write*, and must refuse anything that would
  make a background run raise, or make the poller do far more work than the
  account asked for.
- The readers decide what the engine *does*, and must be total — a blob stored
  before `clean` existed cannot be allowed to kill a run that nobody is
  watching.
"""

from __future__ import annotations

import pytest

from app.services.providers import connection_settings as cs

# ── what may be written ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("patch", "because"),
    [
        ({"people_threshold": "soon"}, "int() would raise inside apply_record, on every poll, forever"),
        ({"people_threshold": 0}, "zero links every correspondent — the flood the threshold prevents"),
        ({"people_threshold": -1}, "negative is the same flood, less obviously"),
        ({"people_threshold": True}, "bool is an int subclass; True as a threshold of 1 is a trap"),
        ({"people_threshold": 10**9}, "an unbounded tally column"),
        ({"calendar": {"calendar_ids": ["c"] * 26}}, "one polled stream per entry: quota burn for the whole instance"),
        ({"calendar": {"calendar_ids": "primary"}}, "a string iterates by letter — one stream per character"),
        ({"calendar": {"calendar_ids": [""]}}, "an empty id polls someone else's default calendar"),
        ({"calendar": {"calendar_ids": [{"id": "x"}]}}, "a dict lands in an f-string as a stream name"),
        ({"calendar": {"backfill_days": -1}}, "negative days is not a window"),
        ({"calendar": {"backfill_days": 10**6}}, "an unbounded first walk"),
        ({"calendar": "primary"}, "a section that is not an object"),
        ({"gmail": {"labels": ["L"] * 26}}, "same amplification through the label filter"),
        ({"gmail": {"store_bodies": "yes"}}, "a truthy string silently switches on body storage"),
        ({"folder_root": 5}, "a non-string prefixed to every note path"),
        ({"folder_root": "../.."}, "traversal collapses to nothing, so there is nothing to store"),
    ],
)
def test_a_value_that_would_break_a_background_run_is_refused(patch: dict, because: str) -> None:
    with pytest.raises(cs.InvalidSetting):
        cs.clean(patch)


def test_the_refusal_names_the_field_so_the_message_is_actionable() -> None:
    with pytest.raises(cs.InvalidSetting) as caught:
        cs.clean({"people_threshold": "soon"})
    assert "people_threshold" in str(caught.value)


def test_good_settings_survive_intact() -> None:
    cleaned = cs.clean(
        {
            "folder_root": "Sources/Google",
            "people_threshold": 5,
            "calendar": {"calendar_ids": ["primary", "work@x.com"], "backfill_days": 30},
            "gmail": {"labels": ["INBOX", "IMPORTANT"], "store_bodies": True},
        }
    )
    assert cleaned == {
        "folder_root": "Sources/Google",
        "people_threshold": 5,
        "calendar": {"calendar_ids": ["primary", "work@x.com"], "backfill_days": 30},
        "gmail": {"labels": ["INBOX", "IMPORTANT"], "store_bodies": True},
    }


def test_duplicate_ids_collapse_before_they_reach_the_stream_table() -> None:
    """`ensure_streams` inserts one row per entry. Two identical ids are two
    rows with the same primary key, one flush apart."""
    cleaned = cs.clean({"calendar": {"calendar_ids": ["primary", " primary ", "primary"]}})
    assert cleaned["calendar"]["calendar_ids"] == ["primary"]


def test_a_folder_prefix_goes_through_the_vaults_own_path_rules() -> None:
    assert cs.clean({"folder_root": "Sources/../Google"})["folder_root"] == "Sources/Google"
    assert cs.clean({"folder_root": "a//b"})["folder_root"] == "a/b"
    assert cs.clean({"folder_root": ""})["folder_root"] == ""


def test_unknown_keys_are_dropped_rather_than_refused() -> None:
    """A client one version ahead must not get a 422 for a field this server
    has not learned yet."""
    assert cs.clean({"people_threshold": 4, "not_a_setting": "x", "gmail": {"future": 1}}) == {
        "people_threshold": 4,
        "gmail": {},
    }


# ── what the engine does with it ────────────────────────────────────────────

POISON = [
    None,
    {},
    {"people_threshold": "soon", "folder_root": None, "calendar": "primary", "gmail": ["INBOX"]},
    {"people_threshold": [], "folder_root": "../..", "calendar": {"calendar_ids": "primary"}},
    {"calendar": {"backfill_days": "many"}, "gmail": {"labels": [None, 3, ""], "store_bodies": "yes"}},
    {"people_threshold": True, "calendar": {"calendar_ids": ["a"] * 5000}},
]


@pytest.mark.parametrize("settings", POISON)
def test_no_reader_raises_on_a_blob_it_did_not_write(settings: object) -> None:
    """These rows predate `clean`, and nothing stops a future writer skipping
    it. A reader that raises here takes down a poll nobody is watching."""
    assert cs.people_threshold(settings) >= 1  # type: ignore[arg-type]
    assert isinstance(cs.folder_root(settings), str)  # type: ignore[arg-type]
    assert cs.backfill_days(settings, "calendar", 365) >= 1  # type: ignore[arg-type]
    assert cs.store_bodies(settings) in (True, False)  # type: ignore[arg-type]
    ids = cs.identifiers(settings, "calendar", "calendar_ids", default=["primary"], limit=25)  # type: ignore[arg-type]
    assert ids and all(isinstance(i, str) and i for i in ids)
    assert len(ids) <= 25


def test_a_string_of_ids_is_never_iterated_by_letter() -> None:
    ids = cs.identifiers(
        {"calendar": {"calendar_ids": "primary"}}, "calendar", "calendar_ids", default=["primary"], limit=25
    )
    assert ids == ["primary"], "a string was walked character by character into one stream each"


def test_a_stored_traversal_prefix_is_neutralised_on_read() -> None:
    assert cs.folder_root({"folder_root": "../../etc"}) == "etc"
    assert cs.folder_root({"folder_root": "../.."}) == ""


def test_readers_clamp_rather_than_trust() -> None:
    assert cs.people_threshold({"people_threshold": 10**9}) == cs.MAX_PEOPLE_THRESHOLD
    assert cs.backfill_days({"calendar": {"backfill_days": 10**9}}, "calendar", 365) == cs.MAX_BACKFILL_DAYS
    many = [f"L{i}" for i in range(900)]
    assert len(cs.identifiers({"gmail": {"labels": many}}, "gmail", "labels", default=["INBOX"], limit=25)) == 25


def test_future_only_is_a_real_choice() -> None:
    """backfill_days 0 means "no history at all — sync from now on"."""
    assert cs.clean({"gmail": {"backfill_days": 0}})["gmail"]["backfill_days"] == 0
    assert cs.backfill_days({"gmail": {"backfill_days": 0}}, "gmail", 90) == 0
    # Poison still falls back rather than becoming an accidental future-only.
    assert cs.backfill_days({"gmail": {"backfill_days": "no"}}, "gmail", 90) == 90
    assert cs.backfill_days({"gmail": {"backfill_days": -3}}, "gmail", 90) == 90


def test_link_toggles_are_booleans_or_refused() -> None:
    cleaned = cs.clean({"link_daily": False, "link_people": True})
    assert cleaned == {"link_daily": False, "link_people": True}
    for bad in ("yes", 1, None):
        with pytest.raises(cs.InvalidSetting):
            cs.clean({"link_daily": bad})
    # Readers are total and default to on.
    assert cs.link_daily(None) is True
    assert cs.link_daily({"link_daily": "yes"}) is True
    assert cs.link_daily({"link_daily": False}) is False
    assert cs.link_people({"link_people": False}) is False


def test_exclude_senders_are_validated_and_lowercased() -> None:
    cleaned = cs.clean({"gmail": {"exclude_senders": [" Noreply@Shop.com ", "shop.com", "noreply@shop.com"]}})
    assert cleaned["gmail"]["exclude_senders"] == ["noreply@shop.com", "shop.com"]
    with pytest.raises(cs.InvalidSetting):
        cs.clean({"gmail": {"exclude_senders": ["ok", ""]}})
    with pytest.raises(cs.InvalidSetting):
        cs.clean({"gmail": {"exclude_senders": ["x"] * 51}})
    # The reader survives a blob clean() never saw.
    assert cs.exclude_senders({"gmail": {"exclude_senders": "not-a-list"}}) == []
    assert cs.exclude_senders(None) == []
