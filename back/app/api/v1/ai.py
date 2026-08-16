"""AI endpoints — the user's own provider key, and chat through it.

No endpoint here ever returns a stored API key. Status reports which providers
are configured and a hint like `sk-ant…7f2a`; that is all a client needs to show
the settings screen, and all it is allowed to know.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.dependencies.auth import CurrentUserId
from app.dependencies.db import SessionDep
from app.services import ai_service

router = APIRouter()


class CredentialRequest(BaseModel):
    provider: str = Field(max_length=32)
    # Omitted = keep the stored key (so the model can be changed on its own).
    api_key: str | None = Field(default=None, max_length=512)
    model: str = Field(default="", max_length=128)
    # Self-hosted / regional endpoints.
    base_url: str | None = Field(default=None, max_length=500)


class ChatMessage(BaseModel):
    role: str = Field(max_length=16)
    content: str = Field(max_length=20_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(max_length=40)
    # Vault context the panel wants the model to have (note title/body excerpt).
    context: str = Field(default="", max_length=20_000)


@router.get("/status")
async def ai_status(user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Which providers this user has configured — never the keys themselves."""
    return {"data": (await ai_service.get_status(db, user_id)).unwrap()}


@router.put("/credentials")
async def save_credential(
    body: CredentialRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    data = (
        await ai_service.save_credential(
            db,
            user_id,
            provider=body.provider,
            api_key=body.api_key,
            model=body.model,
            base_url=body.base_url,
        )
    ).unwrap()
    return {"data": data}


@router.delete("/credentials/{provider}")
async def delete_credential(provider: str, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    (await ai_service.delete_credential(db, user_id, provider)).unwrap()
    return {"data": {"message": "Removed."}}


@router.post("/test/{provider}")
async def test_credential(provider: str, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """Ask the provider for one word, so a bad key fails where it was pasted."""
    return {"data": (await ai_service.test_credential(db, user_id, provider)).unwrap()}


@router.post("/chat")
async def chat(body: ChatRequest, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    system = (
        "You are the assistant inside Nodum, a markdown knowledge base. "
        "Answer in markdown. Link notes with [[wikilinks]] when you refer to them. "
        "Be concise."
    )
    if body.context:
        system += f"\n\nThe note the user is looking at:\n{body.context}"
    data = (
        await ai_service.chat(
            db,
            user_id,
            messages=[{"role": m.role, "content": m.content} for m in body.messages],
            system=system,
        )
    ).unwrap()
    return {"data": data}
