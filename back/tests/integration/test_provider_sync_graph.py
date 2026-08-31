"""Synced notes have to land *in the graph*, which is the point of the feature.

Everything else in this suite proves a note gets written. That is not the
goal — "use it in our knowledge graph" is. A note that arrives correctly and
sits as an isolated node has failed at exactly the thing it was built for, and
nothing about it looks wrong: the note is there, its content is right, the
graph just quietly has one more orphan in it.

The edges are written by `link_service` from the note body, so this walks the
real path — apply_record → note_service → link extraction → links table — and
asserts on the rows the graph view actually reads.
"""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.db import async_session_factory
from app.models.links import Link
from app.models.providers import ProviderConnection
from app.models.vaults import Note
from app.services import daily_note_service, folder_service, note_service, provider_sync_service, providers

STREAM = "calendar:events:primary"
DAY = datetime(2026, 9, 2, 14, 0, tzinfo=UTC)


@pytest.fixture
async def workspace(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"graph-{uuid.uuid4().hex[:12]}@nodumtest.dev",
            "password": "s3cure-Password!",
            "name": "Graph Tester",
        },
    )
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    vaults = (
        await client.get("/api/v1/vaults", headers={"Authorization": f"Bearer {resp.json()['data']['access_token']}"})
    ).json()["data"]
    return {
        "vault_id": uuid.UUID(vaults[0]["id"]),
        "user_id": uuid.UUID(resp.json()["data"]["user"]["id"]),
    }


@pytest.fixture
async def connection(workspace: dict) -> ProviderConnection:
    async with async_session_factory() as session:
        row = ProviderConnection(
            user_id=workspace["user_id"],
            vault_id=workspace["vault_id"],
            provider="google_calendar",
            external_account_id=uuid.uuid4().hex,
            external_email="tester@example.com",
            connected_at=datetime.now(UTC),
            settings={},
            people_counts={},
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


def _event(day: datetime, *, title: str = "Design review", names: tuple[str, ...] = ()) -> providers.SyncRecord:
    """What the Calendar adapter renders, built here so this exercises the
    engine rather than the adapter — which its own tests already cover."""
    body = [f"# {title}", "", f"[[{day.strftime('%Y-%m-%d')}]] 14:00-15:00"]
    if names:
        body += ["", f"With {' and '.join(names)}."]
    return providers.SyncRecord(
        external_id="evt-graph",
        title=title,
        folder=f"Calendar/{day.strftime('%Y/%m')}",
        body="\n".join(body) + "\n",
        external_updated_at=day,
        wants_notes=names,
    )


async def _links_from(session, note_id: uuid.UUID) -> list[Link]:
    return list((await session.execute(select(Link).where(Link.source_note_id == note_id))).scalars())


async def _synced_note(session, connection: ProviderConnection) -> Note:
    note = await session.scalar(select(Note).where(Note.vault_id == connection.vault_id, Note.path.like("Calendar/%")))
    assert note is not None, "the synced note was never written"
    return note


@pytest.mark.asyncio
async def test_a_synced_event_becomes_an_edge_to_the_day_you_journal_into(
    connection: ProviderConnection,
) -> None:
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        assert (
            await provider_sync_service.apply_record(session, row, STREAM, _event(DAY), people_counts={}) == "created"
        )

        note = await _synced_note(session, row)
        links = await _links_from(session, note.id)
        assert [link.target_title for link in links] == ["2026-09-02"], "the event is in the vault but not in the graph"


@pytest.mark.asyncio
async def test_the_edge_resolves_when_the_daily_note_is_written_later(
    connection: ProviderConnection,
) -> None:
    """Events almost always arrive before the day they land on, so the edge is
    unresolved when it is made. If it never resolves, the graph shows a ghost
    node next to the real daily note forever."""
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        await provider_sync_service.apply_record(session, row, STREAM, _event(DAY), people_counts={})
        note = await _synced_note(session, row)
        assert (await _links_from(session, note.id))[0].target_note_id is None

        created = await daily_note_service.open_daily_note(session, row.vault_id, row.user_id, now=DAY)
        assert created.success, created.message

        links = await _links_from(session, note.id)
        assert links[0].target_note_id is not None, "the edge never attached to the daily note"


@pytest.mark.asyncio
async def test_rescheduling_moves_the_edge_instead_of_leaving_a_stale_one(
    connection: ProviderConnection,
) -> None:
    """The failure this guards is entirely silent: the note shows the new date,
    and the graph still shows the old one."""
    moved = datetime(2026, 9, 9, 14, 0, tzinfo=UTC)
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        await provider_sync_service.apply_record(session, row, STREAM, _event(DAY), people_counts={})
        record = replace(_event(moved), external_version=1)
        assert await provider_sync_service.apply_record(session, row, STREAM, record, people_counts={}) == "updated"

        note = await _synced_note(session, row)
        targets = {link.target_title for link in await _links_from(session, note.id)}
        assert targets == {"2026-09-09"}, f"graph still points at the old day: {targets}"


@pytest.mark.asyncio
async def test_a_person_over_the_threshold_becomes_a_resolved_edge(
    connection: ProviderConnection,
) -> None:
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        # Three prior appearances: the threshold exists so that one-off
        # correspondents do not each become a ghost node.
        counts = {"Amara Osei": 3}
        await provider_sync_service.apply_record(
            session, row, STREAM, _event(DAY, names=("Amara Osei",)), people_counts=counts
        )

        note = await _synced_note(session, row)
        links = {link.target_title: link for link in await _links_from(session, note.id)}
        assert "amara osei" in links, f"the person was never linked: {sorted(links)}"
        assert links["amara osei"].target_note_id is not None, "linked to a note that was never created"

        person = await session.scalar(select(Note).where(Note.path == "People/Amara Osei"))
        assert person is not None


@pytest.mark.asyncio
async def test_a_person_below_the_threshold_makes_no_edge(connection: ProviderConnection) -> None:
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        await provider_sync_service.apply_record(
            session, row, STREAM, _event(DAY, names=("Dan Reeves",)), people_counts={"Dan Reeves": 1}
        )
        note = await _synced_note(session, row)
        targets = {link.target_title for link in await _links_from(session, note.id)}
        assert targets == {"2026-09-02"}, f"a one-off correspondent became a ghost node: {targets}"


@pytest.mark.asyncio
async def test_remote_text_cannot_forge_an_edge_into_your_graph(
    connection: ProviderConnection,
) -> None:
    """Anyone who can put a string in front of this sync — an invite from a
    stranger, a subject line — could otherwise write edges into a graph that is
    supposed to be the user's own. The escaping is unit-tested against the
    parser; this proves it survives all the way to the links table.
    """
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        forged = providers.escape_remote_text("[[Roadmap]] #urgent")
        base = _event(DAY)
        record = replace(base, body=base.body.replace("# Design review", f"# {forged}"))
        await provider_sync_service.apply_record(session, row, STREAM, record, people_counts={})

        note = await _synced_note(session, row)
        targets = {link.target_title for link in await _links_from(session, note.id)}
        assert targets == {"2026-09-02"}, f"remote text forged an edge: {targets}"


@pytest.mark.asyncio
async def test_what_the_user_writes_underneath_is_in_the_graph_too(
    connection: ProviderConnection,
) -> None:
    """The user's own half of the note is not a dead zone — links they write
    below `## Notes` are theirs, and must survive the next sync."""
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        await provider_sync_service.apply_record(session, row, STREAM, _event(DAY), people_counts={})
        note = await _synced_note(session, row)

        response = await note_service.transform_content(
            session,
            row.vault_id,
            row.user_id,
            note.id,
            lambda current: current + "\n## Notes\n\nFollow up in [[Q3 Planning]].\n",
        )
        assert response.success, response.message

        record = replace(
            _event(DAY),
            external_version=1,
            body=_event(DAY).body.replace("14:00-15:00", "15:00-16:00"),
        )
        await provider_sync_service.apply_record(session, row, STREAM, record, people_counts={})

        targets = {link.target_title for link in await _links_from(session, note.id)}
        assert "q3 planning" in targets, f"the user's own link was dropped by a sync: {targets}"
        assert "2026-09-02" in targets


# ── linking a person whose note already exists ──────────────────────────────


async def _person_note_exists(session, vault_id: uuid.UUID, name: str) -> bool:
    return (
        await session.scalar(select(Note.id).where(Note.vault_id == vault_id, Note.path == f"People/{name}"))
    ) is not None


@pytest.mark.asyncio
async def test_a_person_the_user_already_wrote_about_is_linked_immediately(
    connection: ProviderConnection,
) -> None:
    """The threshold exists so that a link cannot point at nothing. Once the
    target exists that reasoning is spent, and withholding the link buys
    nothing while costing the connection the user made by hand.
    """
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None

        folder = await folder_service.ensure_folder_path(session, row.vault_id, row.user_id, "People")
        created = await note_service.create_note(
            session,
            row.vault_id,
            row.user_id,
            title="Amara Osei",
            folder_id=folder.data if folder.success else None,
            content="# Amara Osei\n\nRuns the platform team.\n",
        )
        assert created.success, created.message

        # First appearance — far below any threshold.
        await provider_sync_service.apply_record(
            session, row, STREAM, _event(DAY, names=("Amara Osei",)), people_counts={"Amara Osei": 1}
        )
        note = await _synced_note(session, row)
        targets = {link.target_title for link in await _links_from(session, note.id)}
        assert "amara osei" in targets, f"a note the user wrote was left unlinked: {sorted(targets)}"


@pytest.mark.asyncio
async def test_two_connections_in_one_vault_agree_about_a_person(
    workspace: dict, connection: ProviderConnection
) -> None:
    """A calendar and a mailbox count separately, because the tally is per
    connection. Without the existence check the same person is linked from one
    and left plain in the other, in the same vault, for no reason anyone can
    see."""
    async with async_session_factory() as session:
        first = await session.get(ProviderConnection, connection.id)
        assert first is not None
        # The calendar has seen them enough to make the note.
        await provider_sync_service.apply_record(
            session, first, STREAM, _event(DAY, names=("Dan Reeves",)), people_counts={"Dan Reeves": 5}
        )
        assert await _person_note_exists(session, first.vault_id, "Dan Reeves")

        second = ProviderConnection(
            user_id=workspace["user_id"],
            vault_id=workspace["vault_id"],
            provider="google_gmail",
            external_account_id=uuid.uuid4().hex,
            external_email="tester@example.com",
            connected_at=datetime.now(UTC),
            settings={},
            people_counts={},
        )
        session.add(second)
        await session.commit()
        await session.refresh(second)

        # Titles reach the engine already sanitised by the adapter, which is why
        # this one has no colon in it — see the title tests for that half.
        record = replace(_event(DAY, names=("Dan Reeves",)), external_id="thread-1", title="Rollout thread")
        await provider_sync_service.apply_record(
            session, second, "gmail:messages", record, people_counts={"Dan Reeves": 1}
        )

        thread = await session.scalar(
            select(Note).where(Note.vault_id == second.vault_id, Note.title == "Rollout thread")
        )
        assert thread is not None
        targets = {link.target_title for link in await _links_from(session, thread.id)}
        assert "dan reeves" in targets, "the mailbox left plain a person the calendar had linked"


@pytest.mark.asyncio
async def test_a_stranger_with_no_note_is_still_left_as_plain_text(
    connection: ProviderConnection,
) -> None:
    """The existence check must not become a way around the threshold: with no
    note there, a link would be the ghost node it exists to prevent."""
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        await provider_sync_service.apply_record(
            session, row, STREAM, _event(DAY, names=("Someone Once",)), people_counts={"Someone Once": 1}
        )

        note = await _synced_note(session, row)
        targets = {link.target_title for link in await _links_from(session, note.id)}
        assert targets == {"2026-09-02"}, f"a one-off correspondent became a ghost node: {targets}"
        assert not await _person_note_exists(session, row.vault_id, "Someone Once")


@pytest.mark.asyncio
async def test_a_people_note_the_user_deleted_is_not_recreated(
    connection: ProviderConnection,
) -> None:
    """The docs promise a synced note the user deletes is never recreated, and
    call it a decision rather than an accident. That held for event and thread
    notes, which carry a mapping row whose `note_id` is nulled on delete — and
    not for the People notes sync makes on the side, which carried nothing, so
    the next event mentioning that person put the note straight back.

    It is the most infuriating thing a sync engine can do, and the graph is
    exactly where someone curates by deleting.
    """
    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        counts = {"Amara Osei": 5}

        await provider_sync_service.apply_record(
            session, row, STREAM, _event(DAY, names=("Amara Osei",)), people_counts=counts
        )
        person = await session.scalar(
            select(Note).where(Note.vault_id == row.vault_id, Note.path == "People/Amara Osei")
        )
        assert person is not None

        removed = await note_service.delete_note(session, row.vault_id, row.user_id, person.id)
        assert removed.success, removed.message
        assert (
            await session.scalar(select(Note).where(Note.vault_id == row.vault_id, Note.path == "People/Amara Osei"))
            is None
        )

        # A later event mentioning them again.
        later = replace(_event(DAY, names=("Amara Osei",)), external_id="evt-later", title="Retro")
        await provider_sync_service.apply_record(session, row, STREAM, later, people_counts=counts)

        assert (
            await session.scalar(select(Note).where(Note.vault_id == row.vault_id, Note.path == "People/Amara Osei"))
            is None
        ), "a People note the user deleted came back on the next sync"
        retro = await session.scalar(select(Note).where(Note.vault_id == row.vault_id, Note.title == "Retro"))
        assert retro is not None
        targets = {link.target_title for link in await _links_from(session, retro.id)}
        assert "amara osei" not in targets, "linked to a note the user deleted, which is a ghost node"


@pytest.mark.asyncio
async def test_a_deletion_is_respected_by_every_connection_in_the_vault(
    workspace: dict, connection: ProviderConnection
) -> None:
    """People notes are shared across a vault's connections, so the decision to
    delete one has to be as well — otherwise the mailbox puts back what the
    calendar was told to drop."""
    async with async_session_factory() as session:
        first = await session.get(ProviderConnection, connection.id)
        assert first is not None
        await provider_sync_service.apply_record(
            session, first, STREAM, _event(DAY, names=("Dan Reeves",)), people_counts={"Dan Reeves": 5}
        )
        person = await session.scalar(
            select(Note).where(Note.vault_id == first.vault_id, Note.path == "People/Dan Reeves")
        )
        assert person is not None
        await note_service.delete_note(session, first.vault_id, first.user_id, person.id)

        second = ProviderConnection(
            user_id=workspace["user_id"],
            vault_id=workspace["vault_id"],
            provider="google_gmail",
            external_account_id=uuid.uuid4().hex,
            external_email="tester@example.com",
            connected_at=datetime.now(UTC),
            settings={},
            people_counts={},
        )
        session.add(second)
        await session.commit()
        await session.refresh(second)

        record = replace(_event(DAY, names=("Dan Reeves",)), external_id="thread-9", title="Rollout")
        await provider_sync_service.apply_record(
            session, second, "gmail:messages", record, people_counts={"Dan Reeves": 9}
        )

        assert (
            await session.scalar(select(Note).where(Note.vault_id == first.vault_id, Note.path == "People/Dan Reeves"))
            is None
        ), "a second connection recreated a People note the user had deleted"


# ── what a page of a backfill costs ─────────────────────────────────────────


async def _queries_for(connection: ProviderConnection, *, events: int, attendees: int, known: bool = False) -> int:
    """Statements issued applying `events` records that each name `attendees`.

    `known` decides which path is measured, and both matter: with one-off
    attendees nobody has a note, and with `known` everybody does — the steady
    state, because once a first sync is finished almost everyone already has
    one. Measuring only the first hid a worse cost in the second.
    """
    from sqlalchemy import event as sa_event

    prefix = "Known" if known else "Person"
    names = tuple(f"{prefix} {i}" for i in range(attendees))
    counts: dict[str, int] = dict.fromkeys(names, 50) if known else {}
    issued = 0

    async with async_session_factory() as session:
        engine = session.get_bind()

        def _tick(*_args: object, **_kwargs: object) -> None:
            nonlocal issued
            issued += 1

        row = await session.get(ProviderConnection, connection.id)
        assert row is not None
        if known:
            # Make the notes first, so the measured records all take the
            # "already exists" path rather than the one that creates them.
            await provider_sync_service.apply_record(
                session,
                row,
                STREAM,
                replace(_event(DAY, names=names), external_id=f"warm-{attendees}"),
                people_counts=counts,
            )
        sa_event.listen(engine, "before_cursor_execute", _tick)
        try:
            for index in range(events):
                record = replace(
                    _event(DAY, names=names),
                    external_id=f"{attendees}-evt-{index}",
                    title=f"Event {attendees}-{index}",
                )
                await provider_sync_service.apply_record(session, row, STREAM, record, people_counts=counts)
        finally:
            sa_event.remove(engine, "before_cursor_execute", _tick)
    return issued


@pytest.mark.asyncio
async def test_people_cost_a_page_not_a_person(connection: ProviderConnection) -> None:
    """Both questions asked about a person — does their note exist, did someone
    delete it — are set-shaped, and asking them name by name made a backfill
    page cost two extra queries per attendee.

    Measured when that regressed: 939 statements for 25 events with 8
    attendees each, against 539 before. A first sync walks eight pages of up
    to 250 events, so it is not academic.

    Asserted as a *shape* rather than a number: going from 2 attendees to 16
    must not multiply the work, because that is the property that broke. An
    absolute count would only measure how many other queries happen to sit in
    `apply_record`.
    """
    few = await _queries_for(connection, events=5, attendees=2)
    many = await _queries_for(connection, events=5, attendees=16)

    # Eight times the people, and the extra cost must not scale with them.
    assert many <= few + 15, f"{few} queries for 2 attendees, {many} for 16 — the per-person questions came back"


@pytest.mark.asyncio
async def test_people_who_already_have_notes_cost_a_page_too(connection: ProviderConnection) -> None:
    """The steady state, and the one the first version of this test missed.

    Once a first sync has finished almost every attendee already has a note,
    so the branch that runs forever is the "already exists" one — and it was
    the more expensive of the two: a second query for the id the first had
    already seen, then an insert and a commit *per person*. Measured at 950
    statements for 25 events with 8 known people, against 575 after.
    """
    few = await _queries_for(connection, events=5, attendees=2, known=True)
    many = await _queries_for(connection, events=5, attendees=16, known=True)

    assert many <= few + 15, (
        f"{few} queries for 2 known people, {many} for 16 — remembering them went back to per-person"
    )


@pytest.mark.asyncio
async def test_re_syncing_does_not_rewrite_what_it_already_knows(
    connection: ProviderConnection,
) -> None:
    """The path that runs every five minutes forever.

    Neither cost guard above covers it: both apply records with fresh ids, so
    both measure creation. An update re-asks which of the record's people have
    notes — it has to, they can be deleted between runs — but the mapping rows
    it writes never change after the first time, and re-writing them cost a
    round trip and a commit per record indefinitely.

    Asserted by *kind* rather than count: no write to the people mappings at
    all on a re-sync, which is the property, rather than a number that drifts
    with everything else `apply_record` does.
    """
    from sqlalchemy import event as sa_event

    names = tuple(f"Regular {i}" for i in range(6))
    counts = dict.fromkeys(names, 50)
    people_writes = 0

    async with async_session_factory() as session:
        row = await session.get(ProviderConnection, connection.id)
        assert row is not None

        for index in range(3):
            await provider_sync_service.apply_record(
                session,
                row,
                STREAM,
                replace(_event(DAY, names=names), external_id=f"re-{index}", title=f"Re {index}"),
                people_counts=counts,
            )

        def _tick(_conn: object, _cursor: object, statement: str, *_rest: object) -> None:
            nonlocal people_writes
            # Counted by statement, not by matching a value inside it: the
            # stream name is a bound parameter and never appears in the SQL,
            # so looking for it there matched nothing and this test passed
            # while measuring nothing at all.
            if " ".join(statement.split()).lower().startswith("insert into external_objects"):
                people_writes += 1

        engine = session.get_bind()
        sa_event.listen(engine, "before_cursor_execute", _tick)
        try:
            for index in range(3):
                record = replace(
                    _event(DAY, names=names),
                    external_id=f"re-{index}",
                    title=f"Re {index}",
                    external_version=2,
                )
                record = replace(record, body=record.body + "\nrescheduled\n")
                assert (
                    await provider_sync_service.apply_record(session, row, STREAM, record, people_counts=counts)
                    == "updated"
                )
        finally:
            sa_event.remove(engine, "before_cursor_execute", _tick)

    # One per record, from `_record_mapping`, which has to run — the record's
    # own hash changed. Anything beyond that is the people mappings being
    # rewritten with nothing new to say.
    assert people_writes == 3, (
        f"{people_writes} external_objects writes for 3 updated records; expected one each, so "
        f"{people_writes - 3} were people mappings re-written on a re-sync that learned nothing new"
    )
