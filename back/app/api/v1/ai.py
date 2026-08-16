"""AI endpoints — the user's own provider key, and chat through it.

No endpoint here ever returns a stored API key. Status reports which providers
are configured and a hint like `sk-ant…7f2a`; that is all a client needs to show
the settings screen, and all it is allowed to know.
"""

from typing import Any
from uuid import UUID

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


class VaultChatRequest(BaseModel):
    """One new message. The rest of the transcript comes from the stored
    conversation — the client cannot rewrite what the model was told."""

    message: str = Field(max_length=20_000)
    conversation_id: UUID | None = None
    # Vault context the panel wants the model to have (note title/body excerpt).
    context: str = Field(default="", max_length=20_000)


class RenameConversationRequest(BaseModel):
    title: str = Field(max_length=200)



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


@router.get("/vaults/{vault_id}/conversations")
async def list_conversations(vault_id: UUID, user_id: CurrentUserId, db: SessionDep) -> dict[str, Any]:
    """This vault's saved chats, most recently used first."""
    return {"data": (await ai_service.list_conversations(db, user_id, vault_id)).unwrap()}


@router.get("/vaults/{vault_id}/conversations/{conversation_id}")
async def get_conversation(
    vault_id: UUID, conversation_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """One saved chat, in full — this is what a reloaded panel restores from."""
    return {"data": (await ai_service.get_conversation(db, user_id, vault_id, conversation_id)).unwrap()}


@router.patch("/vaults/{vault_id}/conversations/{conversation_id}")
async def rename_conversation(
    vault_id: UUID,
    conversation_id: UUID,
    body: RenameConversationRequest,
    user_id: CurrentUserId,
    db: SessionDep,
) -> dict[str, Any]:
    data = (
        await ai_service.rename_conversation(db, user_id, vault_id, conversation_id, body.title)
    ).unwrap()
    return {"data": data}


@router.delete("/vaults/{vault_id}/conversations/{conversation_id}")
async def delete_conversation(
    vault_id: UUID, conversation_id: UUID, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    (await ai_service.delete_conversation(db, user_id, vault_id, conversation_id)).unwrap()
    return {"data": {"message": "Deleted."}}


@router.post("/vaults/{vault_id}/chat")
async def chat_in_vault(
    vault_id: UUID, body: VaultChatRequest, user_id: CurrentUserId, db: SessionDep
) -> dict[str, Any]:
    """A chat turn the assistant can answer by searching, reading, creating and
    extending notes in this vault. The turn is appended to the conversation
    (a new one is started when no id is given), and every write to the vault is
    reported back in `actions`."""
    data = (
        await ai_service.chat_with_vault(
            db,
            user_id,
            vault_id,
            message=body.message,
            conversation_id=body.conversation_id,
            context=body.context,
        )
    ).unwrap()
    return {"data": data}


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
