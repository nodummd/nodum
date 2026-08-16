"""AI credentials and chat.

The user's provider key is theirs: they paste it, they pay for the calls, and
they can delete it. Our job is to hold it safely (encrypted at rest, never
returned to any client, never logged) and to use it only for requests that user
asked for.

The active provider is a plain preference on `users.settings` (`aiProvider`);
the key itself lives in `ai_credentials`, out of reach of the settings blob that
gets serialized to the browser.
"""

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AICredential
from app.models.auth import User
from app.services import ai_providers
from app.services.ai_providers import PROVIDERS, ProviderError
from app.services.service_response import ServiceResponse
from app.utils.crypto_utils import decrypt_secret, encrypt_secret, encryption_available, mask_secret

logger = logging.getLogger(__name__)

ACTIVE_PROVIDER_KEY = "aiProvider"
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 20_000


async def _credential(db: AsyncSession, user_id: UUID, provider: str) -> AICredential | None:
    result = await db.execute(
        select(AICredential).where(AICredential.user_id == user_id, AICredential.provider == provider)
    )
    return result.scalar_one_or_none()


async def _all_credentials(db: AsyncSession, user_id: UUID) -> list[AICredential]:
    result = await db.execute(
        select(AICredential).where(AICredential.user_id == user_id).order_by(AICredential.created_at)
    )
    return list(result.scalars().all())


async def get_status(db: AsyncSession, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    """What the client is allowed to know: which providers have a key, which one
    is active, and a hint that identifies each key without revealing it."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    credentials = await _all_credentials(db, user_id)
    configured = {c.provider: c for c in credentials}
    active = (user.settings or {}).get(ACTIVE_PROVIDER_KEY)
    if active not in configured:
        # A provider whose key was deleted must not stay "active", or chat would
        # keep failing with a confusing "not configured".
        active = next(iter(configured), None)
    return ServiceResponse.ok(
        {
            "available": encryption_available(),
            "configured": bool(configured),
            "active_provider": active,
            "active_model": configured[active].model if active else "",
            "credentials": [
                {
                    "provider": c.provider,
                    "model": c.model,
                    "key_hint": c.key_hint,
                    "base_url": c.base_url or "",
                }
                for c in credentials
            ],
            "providers": [
                {
                    "id": p.id,
                    "label": p.label,
                    "default_model": p.default_model,
                    "models": list(p.models),
                    "key_url": p.key_url,
                }
                for p in PROVIDERS.values()
            ],
        }
    )


async def save_credential(
    db: AsyncSession,
    user_id: UUID,
    *,
    provider: str,
    api_key: str | None,
    model: str,
    base_url: str | None,
    make_active: bool = True,
) -> ServiceResponse[dict[str, Any]]:
    """Store (or update) a provider key. An omitted key keeps the stored one, so
    the model can be changed without re-pasting it."""
    if provider not in PROVIDERS:
        return ServiceResponse.fail("validation_failed", "Unknown provider.")
    if not encryption_available():
        return ServiceResponse.fail(
            "validation_failed",
            "This server has no AI_ENCRYPTION_KEY configured, so it cannot store a key safely.",
        )
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")

    existing = await _credential(db, user_id, provider)
    key = (api_key or "").strip()
    if not key and existing is None:
        return ServiceResponse.fail("validation_failed", "An API key is required.")

    chosen_model = (model or "").strip() or (existing.model if existing else "") or PROVIDERS[provider].default_model
    endpoint = (base_url or "").strip() or None

    if existing is None:
        existing = AICredential(
            user_id=user_id,
            provider=provider,
            key_ciphertext=encrypt_secret(key),
            key_hint=mask_secret(key),
            model=chosen_model,
            base_url=endpoint,
        )
        db.add(existing)
    else:
        if key:
            existing.key_ciphertext = encrypt_secret(key)
            existing.key_hint = mask_secret(key)
        existing.model = chosen_model
        existing.base_url = endpoint

    if make_active:
        user.settings = {**(user.settings or {}), ACTIVE_PROVIDER_KEY: provider}
    await db.commit()
    return ServiceResponse.ok({"provider": provider, "model": chosen_model, "key_hint": existing.key_hint})


async def delete_credential(db: AsyncSession, user_id: UUID, provider: str) -> ServiceResponse[None]:
    credential = await _credential(db, user_id, provider)
    if credential is None:
        return ServiceResponse.fail("not_found", "No key stored for that provider.")
    await db.delete(credential)
    user = await db.get(User, user_id)
    if user is not None and (user.settings or {}).get(ACTIVE_PROVIDER_KEY) == provider:
        settings = {**(user.settings or {})}
        settings.pop(ACTIVE_PROVIDER_KEY, None)
        user.settings = settings
    await db.commit()
    return ServiceResponse.ok(None)


async def resolve(
    db: AsyncSession, user_id: UUID, provider: str | None = None
) -> ServiceResponse[tuple[AICredential, str]]:
    """The credential to use plus its decrypted key. Never leaves this module's
    callers — the key must not reach a response body."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    wanted = provider or (user.settings or {}).get(ACTIVE_PROVIDER_KEY)
    credential = await _credential(db, user_id, wanted) if wanted else None
    if credential is None:
        # Fall back to any stored key: better than refusing because the active
        # pointer went stale.
        credentials = await _all_credentials(db, user_id)
        credential = credentials[0] if credentials else None
    if credential is None:
        return ServiceResponse.fail("not_found", "No AI provider is configured.")
    key = decrypt_secret(credential.key_ciphertext)
    if not key:
        return ServiceResponse.fail(
            "validation_failed",
            "The stored API key could not be read — re-enter it in Settings → AI.",
        )
    return ServiceResponse.ok((credential, key))


async def test_credential(db: AsyncSession, user_id: UUID, provider: str) -> ServiceResponse[dict[str, Any]]:
    """One cheap round-trip, so a wrong key is caught where it was pasted."""
    resolved = await resolve(db, user_id, provider)
    if not resolved.success:
        return ServiceResponse.fail(resolved.error_code or "not_found", resolved.message)
    credential, key = resolved.data
    try:
        reply = await ai_providers.chat(
            provider=credential.provider,
            api_key=key,
            model=credential.model,
            messages=[{"role": "user", "content": "Reply with the single word: ready"}],
            max_tokens=16,
        )
    except ProviderError as exc:
        return ServiceResponse.fail("validation_failed", str(exc))
    except Exception:  # network, DNS, timeout — never surface the raw text
        logger.warning("ai test failed for provider=%s", credential.provider, exc_info=True)
        return ServiceResponse.fail("validation_failed", "Could not reach the provider.")
    return ServiceResponse.ok({"provider": credential.provider, "model": credential.model, "reply": reply[:200]})


async def chat(
    db: AsyncSession,
    user_id: UUID,
    *,
    messages: list[dict[str, str]],
    system: str = "",
) -> ServiceResponse[dict[str, Any]]:
    """One chat turn through the user's configured provider."""
    if not messages:
        return ServiceResponse.fail("validation_failed", "No messages.")
    if len(messages) > MAX_MESSAGES:
        messages = messages[-MAX_MESSAGES:]
    for message in messages:
        if message.get("role") not in ("user", "assistant"):
            return ServiceResponse.fail("validation_failed", "Messages must be from user or assistant.")
        if len(message.get("content", "")) > MAX_MESSAGE_CHARS:
            return ServiceResponse.fail("validation_failed", "That message is too long.")

    resolved = await resolve(db, user_id)
    if not resolved.success:
        return ServiceResponse.fail(resolved.error_code or "not_found", resolved.message)
    credential, key = resolved.data
    try:
        reply = await ai_providers.chat(
            provider=credential.provider,
            api_key=key,
            model=credential.model,
            messages=messages,
            system=system,
            base_url=credential.base_url,
        )
    except ProviderError as exc:
        return ServiceResponse.fail("validation_failed", str(exc))
    except Exception:
        logger.warning("ai chat failed for provider=%s", credential.provider, exc_info=True)
        return ServiceResponse.fail("validation_failed", "Could not reach the provider.")
    return ServiceResponse.ok({"reply": reply, "provider": credential.provider, "model": credential.model})
