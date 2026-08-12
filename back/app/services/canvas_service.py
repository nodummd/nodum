"""Canvas service — CRUD for JSON Canvas boards."""

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vaults import Canvas
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault

MAX_CANVAS_NODES = 500
MAX_CANVAS_BYTES = 1024 * 1024  # 1MB of JSON


def _validate_data(data: Any) -> str | None:
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        return "Canvas data must be {nodes: [], edges: []}."
    if len(data["nodes"]) > MAX_CANVAS_NODES:
        return f"Canvas is limited to {MAX_CANVAS_NODES} cards."
    if len(json.dumps(data)) > MAX_CANVAS_BYTES:
        return "Canvas data is too large."
    return None


def _meta(c: Canvas) -> dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "updated_at": c.updated_at.isoformat()}


async def _owned_canvas(db: AsyncSession, vault_id: UUID, user_id: UUID, canvas_id: UUID) -> Canvas | None:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return None
    return await db.scalar(select(Canvas).where(Canvas.id == canvas_id, Canvas.vault_id == vault_id))


async def list_canvases(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[list[dict[str, Any]]]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    rows = (await db.scalars(select(Canvas).where(Canvas.vault_id == vault_id).order_by(Canvas.name))).all()
    return ServiceResponse.ok([_meta(c) for c in rows])


async def create_canvas(db: AsyncSession, vault_id: UUID, user_id: UUID, *, name: str) -> ServiceResponse[Canvas]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    name = name.strip()
    if not name or len(name) > 255:
        return ServiceResponse.fail("validation_failed", "Canvas name must be 1-255 characters.")
    exists = await db.scalar(select(Canvas.id).where(Canvas.vault_id == vault_id, Canvas.name == name))
    if exists:
        return ServiceResponse.fail("already_exists", "A canvas with this name already exists.")
    canvas = Canvas(vault_id=vault_id, name=name, data={"nodes": [], "edges": []})
    db.add(canvas)
    await db.commit()
    await db.refresh(canvas)
    return ServiceResponse.ok(canvas)


async def get_canvas(db: AsyncSession, vault_id: UUID, user_id: UUID, canvas_id: UUID) -> ServiceResponse[Canvas]:
    canvas = await _owned_canvas(db, vault_id, user_id, canvas_id)
    if canvas is None:
        return ServiceResponse.fail("not_found", "Canvas not found.")
    return ServiceResponse.ok(canvas)


async def update_data(
    db: AsyncSession, vault_id: UUID, user_id: UUID, canvas_id: UUID, *, data: dict[str, Any]
) -> ServiceResponse[Canvas]:
    canvas = await _owned_canvas(db, vault_id, user_id, canvas_id)
    if canvas is None:
        return ServiceResponse.fail("not_found", "Canvas not found.")
    if err := _validate_data(data):
        return ServiceResponse.fail("validation_failed", err)
    canvas.data = data
    await db.commit()
    await db.refresh(canvas)
    return ServiceResponse.ok(canvas)


async def rename_canvas(
    db: AsyncSession, vault_id: UUID, user_id: UUID, canvas_id: UUID, *, name: str
) -> ServiceResponse[Canvas]:
    canvas = await _owned_canvas(db, vault_id, user_id, canvas_id)
    if canvas is None:
        return ServiceResponse.fail("not_found", "Canvas not found.")
    name = name.strip()
    if not name or len(name) > 255:
        return ServiceResponse.fail("validation_failed", "Canvas name must be 1-255 characters.")
    canvas.name = name
    await db.commit()
    await db.refresh(canvas)
    return ServiceResponse.ok(canvas)


async def delete_canvas(db: AsyncSession, vault_id: UUID, user_id: UUID, canvas_id: UUID) -> ServiceResponse[None]:
    canvas = await _owned_canvas(db, vault_id, user_id, canvas_id)
    if canvas is None:
        return ServiceResponse.fail("not_found", "Canvas not found.")
    await db.delete(canvas)
    await db.commit()
    return ServiceResponse.ok(None)
