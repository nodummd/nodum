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
from app.services import daily_note_service, note_service, provider_sync_service, providers

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
