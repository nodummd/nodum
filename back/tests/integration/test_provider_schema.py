"""The provider tables' migration and models have to describe the same thing.

`0022_provider_sync` was written before the engine existed and then edited
across every iteration that added a column. Alembic never re-runs an applied
migration, so a divergence between it and the models does not show up locally
at all — it shows up on the first deploy to a fresh database, as an
`UndefinedColumn` from a background task nobody is watching.

Columns are the dangerous half and the integration suite already covers them
by construction, since it runs against a migrated schema. Indexes are the
quiet half: an index that exists only in the migration is one that
`--autogenerate` proposes dropping, and losing the dispatcher's index costs
nothing visible — the sweep just gets slower as connections are added.
"""

import pytest
from sqlalchemy import inspect

from app.core.db import async_session_factory
from app.models.base import Base

TABLES = ("provider_connections", "sync_streams", "external_objects")


async def _inspect(fn):
    async with async_session_factory() as session:
        connection = await session.connection()
        return await connection.run_sync(lambda sync_conn: fn(inspect(sync_conn)))


@pytest.mark.asyncio
@pytest.mark.parametrize("table", TABLES)
async def test_the_migration_built_the_columns_the_model_expects(table: str) -> None:
    model = Base.metadata.tables[table]
    actual = await _inspect(lambda i: {c["name"]: c for c in i.get_columns(table)})

    missing = set(model.columns.keys()) - set(actual)
    assert not missing, f"{table}: the model reads {sorted(missing)}, the migration never created them"

    extra = set(actual) - set(model.columns.keys())
    assert not extra, f"{table}: the migration created {sorted(extra)}, which no model knows about"

    for name, column in model.columns.items():
        # A column the model treats as required but the database allows to be
        # null fails on write, not on deploy — much later, and to a user.
        assert actual[name]["nullable"] == column.nullable, (
            f"{table}.{name}: model nullable={column.nullable}, database nullable={actual[name]['nullable']}"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("table", TABLES)
async def test_every_index_in_the_database_is_one_the_models_declare(table: str) -> None:
    """Both directions matter.

    An index only in the migration is one autogenerate will offer to drop. An
    index only in the models is one that was never actually created, so the
    query it was added for is doing a sequential scan while the model says
    otherwise.
    """
    model = Base.metadata.tables[table]
    # Postgres backs every UNIQUE constraint with an index and reports it as
    # one, so the constraint names count as declared or they read as strays.
    declared = {index.name for index in model.indexes} | {
        constraint.name for constraint in model.constraints if constraint.name
    }
    actual = {index["name"] for index in await _inspect(lambda i: i.get_indexes(table))}

    undeclared = actual - declared
    assert not undeclared, f"{table}: {sorted(undeclared)} exists but no model declares it — autogenerate will drop it"

    uncreated = {index.name for index in model.indexes} - actual
    assert not uncreated, f"{table}: {sorted(uncreated)} is declared but was never created"


@pytest.mark.asyncio
async def test_the_dispatchers_index_exists() -> None:
    """Named explicitly because it is the one with no visible failure mode.

    `due_connections` runs every tick against every connection on the
    instance. Without this index nothing breaks, nothing logs, and the sweep
    simply degrades as the table grows.
    """
    actual = {index["name"] for index in await _inspect(lambda i: i.get_indexes("provider_connections"))}
    assert "ix_provider_connections_due" in actual
