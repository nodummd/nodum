"""The Demo Workspace — a populated vault a new user can explore before writing.

The content ships with the app as a fixture (`app/fixtures/demo_vault/`, 209
linked notes across topics, people, books, projects, daily notes and recipes)
plus a manifest with the folder colours, graph groups and canvas background.
It goes in through the same import path a zipped Obsidian vault does, so links
resolve and tags sync exactly as they would for the user's own notes.

Colours in the manifest are keyed by PATH, not id: ids differ on every install,
paths do not. They are mapped onto the created folders after the import.
"""

import io
import json
import zipfile
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.vaults import Folder, Note, Vault
from app.services import vault_io_service, vault_service
from app.services.service_response import ServiceResponse

logger = get_logger("demo")

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "demo_vault"
MANIFEST_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "demo_vault.json"


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _fixture_zip() -> bytes:
    """The fixture tree as an in-memory zip — what import_zip understands."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(FIXTURE_DIR.rglob("*.md")):
            zf.write(path, path.relative_to(FIXTURE_DIR).as_posix())
    return buffer.getvalue()


async def _unique_vault_name(db: AsyncSession, user_id: UUID, base: str) -> str:
    """ "Demo Workspace", then "Demo Workspace 2", … — a second demo is allowed."""
    taken = set((await db.execute(select(Vault.name).where(Vault.user_id == user_id))).scalars().all())
    if base not in taken:
        return base
    n = 2
    while f"{base} {n}" in taken:
        n += 1
    return f"{base} {n}"


async def create_demo_vault(db: AsyncSession, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """Create the demo vault for a user and return `{vault, open_note_id, imported}`."""
    manifest = load_manifest()
    name = await _unique_vault_name(db, user_id, manifest.get("name", "Demo Workspace"))

    created = await vault_service.create_vault(db, user_id, name=name)
    if not created.success:
        return ServiceResponse.fail(created.error_code or "validation_failed", created.message)
    vault = created.data
    assert vault is not None

    imported = await vault_io_service.import_zip(db, vault.id, user_id, archive=_fixture_zip())
    if not imported.success:
        # Never leave an empty "Demo Workspace" behind — the user would open
        # it and find nothing, and the next offer would say the name is taken.
        await vault_service.delete_vault(db, vault.id, user_id)
        return ServiceResponse.fail(imported.error_code or "validation_failed", imported.message)

    # Colours by path → by id, now that the folders exist.
    folder_colors: dict[str, str] = manifest.get("folder_colors", {})
    if folder_colors:
        rows = (await db.execute(select(Folder.id, Folder.path).where(Folder.vault_id == vault.id))).all()
        by_path = {path: str(folder_id) for folder_id, path in rows}
        item_colors = {by_path[p]: c for p, c in folder_colors.items() if p in by_path}
    else:
        item_colors = {}

    patch: dict[str, Any] = {"itemColors": item_colors, "demo": True}
    if manifest.get("graph"):
        patch["graph"] = manifest["graph"]
    if manifest.get("canvasBackground"):
        patch["canvasBackground"] = manifest["canvasBackground"]
    updated = await vault_service.update_vault_settings(db, vault.id, user_id, settings_patch=patch)
    if updated.success and updated.data is not None:
        vault = updated.data

    open_note_id: str | None = None
    if manifest.get("open_note"):
        open_note_id = await db.scalar(
            select(Note.id).where(Note.vault_id == vault.id, Note.path == manifest["open_note"])
        )

    logger.info("demo_vault_created", vault_id=str(vault.id), imported=imported.data["imported"])
    return ServiceResponse.ok(
        {
            "vault": vault,
            "open_note_id": str(open_note_id) if open_note_id else None,
            "imported": imported.data["imported"],
        }
    )
