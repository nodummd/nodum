"""Public API — ask the vault questions through the owner's AI provider."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.api.public.deps import AiUser
from app.api.public.schemas import AiAnswer, AiAsk, Envelope
from app.dependencies.db import SessionDep
from app.services import ai_service

router = APIRouter()


@router.post("/ask", summary="Ask the vault", response_model=Envelope[AiAnswer])
async def ask(vault_id: UUID, body: AiAsk, user_id: AiUser, db: SessionDep) -> Any:
    """One chat turn that can search, read — and write — the vault, answered in full.

    Uses the AI provider and key configured in **Settings → AI** (or the
    vault's own); without one this returns **404**. The assistant may take
    several provider round-trips, so allow a generous client timeout (120s+).
    Because its tools include note creation, an `ai`-scoped key can change
    the vault even without `write`.
    """
    result = (
        await ai_service.chat_with_vault(
            db, user_id, vault_id, message=body.message, conversation_id=body.conversation_id, context=body.context
        )
    ).unwrap()
    return {"ok": True, "data": result}
