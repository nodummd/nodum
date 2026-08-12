"""Canvas endpoints — JSON Canvas board CRUD."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import canvas_service

router = APIRouter()


class CanvasCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class CanvasDataRequest(BaseModel):
    data: dict[str, Any]


class CanvasRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


def _full(c: Any) -> dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "data": c.data, "updated_at": c.updated_at.isoformat()}


@router.get("")
async def list_canvases(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    data = (await canvas_service.list_canvases(db, vault_id, user_id)).unwrap()
    return {"data": data}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_canvas(
    vault_id: UUID, body: CanvasCreateRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    canvas = (await canvas_service.create_canvas(db, vault_id, user_id, name=body.name)).unwrap()
    return {"data": _full(canvas)}


@router.get("/{canvas_id}")
async def get_canvas(vault_id: UUID, canvas_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    canvas = (await canvas_service.get_canvas(db, vault_id, user_id, canvas_id)).unwrap()
    return {"data": _full(canvas)}


@router.put("/{canvas_id}/data")
async def update_canvas_data(
    vault_id: UUID, canvas_id: UUID, body: CanvasDataRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    canvas = (await canvas_service.update_data(db, vault_id, user_id, canvas_id, data=body.data)).unwrap()
    return {"data": _full(canvas)}


@router.patch("/{canvas_id}/rename")
async def rename_canvas(
    vault_id: UUID, canvas_id: UUID, body: CanvasRenameRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    canvas = (await canvas_service.rename_canvas(db, vault_id, user_id, canvas_id, name=body.name)).unwrap()
    return {"data": _full(canvas)}


@router.delete("/{canvas_id}")
async def delete_canvas(vault_id: UUID, canvas_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    (await canvas_service.delete_canvas(db, vault_id, user_id, canvas_id)).unwrap()
    return {"data": {"message": "Canvas deleted."}}
