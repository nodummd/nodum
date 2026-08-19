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
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIConversation, AICredential, AIMessage
from app.models.auth import User
from app.services import ai_providers, ai_tools
from app.services.ai_providers import PROVIDERS, ProviderError
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault
from app.settings import get_settings
from app.utils.crypto_utils import decrypt_secret, encrypt_secret, encryption_available, mask_secret
from app.utils.url_guard import UnsafeUrlError, assert_safe_url

logger = logging.getLogger(__name__)

ACTIVE_PROVIDER_KEY = "aiProvider"
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 20_000


def _scope_clause(vault_id: UUID | None) -> Any:
    """Account-level rows have vault_id NULL; a vault's own rows carry its id."""
    return AICredential.vault_id.is_(None) if vault_id is None else AICredential.vault_id == vault_id


async def _credential(
    db: AsyncSession, user_id: UUID, provider: str, vault_id: UUID | None = None
) -> AICredential | None:
    result = await db.execute(
        select(AICredential).where(
            AICredential.user_id == user_id, AICredential.provider == provider, _scope_clause(vault_id)
        )
    )
    return result.scalar_one_or_none()


async def _all_credentials(db: AsyncSession, user_id: UUID, vault_id: UUID | None = None) -> list[AICredential]:
    result = await db.execute(
        select(AICredential)
        .where(AICredential.user_id == user_id, _scope_clause(vault_id))
        .order_by(AICredential.created_at)
    )
    return list(result.scalars().all())


async def _active_provider(db: AsyncSession, user: User, vault_id: UUID | None) -> str | None:
    """The provider a scope points at: `users.settings.aiProvider` for the
    account, `vault.settings.aiProvider` for a vault."""
    if vault_id is None:
        return (user.settings or {}).get(ACTIVE_PROVIDER_KEY)
    vault = await get_owned_vault(db, vault_id, user.id)
    return (vault.settings or {}).get(ACTIVE_PROVIDER_KEY) if vault is not None else None


def _pick(credentials: list[AICredential], wanted: str | None) -> AICredential | None:
    configured = {c.provider: c for c in credentials}
    if wanted in configured:
        return configured[wanted]
    # A provider whose key was deleted must not stay "active", or chat would
    # keep failing with a confusing "not configured".
    return next(iter(configured.values()), None)


def _scope_status(credentials: list[AICredential], wanted: str | None) -> dict[str, Any]:
    active = _pick(credentials, wanted)
    return {
        "configured": bool(credentials),
        "active_provider": active.provider if active else None,
        "active_model": active.model if active else "",
        "credentials": [
            {
                "provider": c.provider,
                "model": c.model,
                "key_hint": c.key_hint,
                "base_url": c.base_url or "",
            }
            for c in credentials
        ],
    }


async def get_status(db: AsyncSession, user_id: UUID, vault_id: UUID | None = None) -> ServiceResponse[dict[str, Any]]:
    """What the client is allowed to know: which providers have a key, which one
    is active, and a hint that identifies each key without revealing it.

    With a `vault_id`, also that vault's own keys, and which scope chat in it
    actually uses (`effective_scope`: "vault" when the vault has a key of its
    own, "account" otherwise, null when neither has one)."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    account = _scope_status(await _all_credentials(db, user_id), (user.settings or {}).get(ACTIVE_PROVIDER_KEY))
    vault_scope: dict[str, Any] | None = None
    effective_scope: str | None = "account" if account["configured"] else None
    if vault_id is not None:
        if await get_owned_vault(db, vault_id, user_id) is None:
            return ServiceResponse.fail("not_found", "Vault not found.")
        vault_scope = _scope_status(
            await _all_credentials(db, user_id, vault_id), await _active_provider(db, user, vault_id)
        )
        if vault_scope["configured"]:
            effective_scope = "vault"
    effective = vault_scope if effective_scope == "vault" else account
    return ServiceResponse.ok(
        {
            "available": encryption_available(),
            # Top level = what chat in this context will use (the vault's own
            # keys when it has any, the account's otherwise) — the panel's
            # "is AI set up?" question in one field.
            "configured": bool(effective["configured"]),
            "active_provider": effective["active_provider"],
            "active_model": effective["active_model"],
            "credentials": account["credentials"],
            "account": account,
            "vault": vault_scope,
            "effective_scope": effective_scope,
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
    vault_id: UUID | None = None,
) -> ServiceResponse[dict[str, Any]]:
    """Store (or update) a provider key — for the account, or for one vault
    (`vault_id`), whose own key then wins for chat in that vault. An omitted
    key keeps the stored one, so the model can be changed without re-pasting it."""
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
    vault = None
    if vault_id is not None:
        vault = await get_owned_vault(db, vault_id, user_id)
        if vault is None:
            return ServiceResponse.fail("not_found", "Vault not found.")

    existing = await _credential(db, user_id, provider, vault_id)
    key = (api_key or "").strip()
    if not key and existing is None:
        return ServiceResponse.fail("validation_failed", "An API key is required.")

    chosen_model = (model or "").strip() or (existing.model if existing else "") or PROVIDERS[provider].default_model
    endpoint = (base_url or "").strip() or None

    # A custom endpoint is a URL the server will POST to with a bearer token.
    # Reject it here as well as at request time so the user gets a clear error
    # at the moment they set it, rather than a confusing failure later.
    if endpoint is not None:
        try:
            await assert_safe_url(endpoint, allow_private=get_settings().AI_ALLOW_PRIVATE_BASE_URLS)
        except UnsafeUrlError as exc:
            return ServiceResponse.fail("validation_failed", str(exc))

    if existing is None:
        existing = AICredential(
            user_id=user_id,
            vault_id=vault_id,
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
        if vault is not None:
            vault.settings = {**(vault.settings or {}), ACTIVE_PROVIDER_KEY: provider}
        else:
            user.settings = {**(user.settings or {}), ACTIVE_PROVIDER_KEY: provider}
    await db.commit()
    return ServiceResponse.ok(
        {
            "provider": provider,
            "model": chosen_model,
            "key_hint": existing.key_hint,
            "scope": "vault" if vault_id is not None else "account",
        }
    )


async def delete_credential(
    db: AsyncSession, user_id: UUID, provider: str, vault_id: UUID | None = None
) -> ServiceResponse[None]:
    credential = await _credential(db, user_id, provider, vault_id)
    if credential is None:
        return ServiceResponse.fail("not_found", "No key stored for that provider.")
    await db.delete(credential)
    if vault_id is not None:
        vault = await get_owned_vault(db, vault_id, user_id)
        if vault is not None and (vault.settings or {}).get(ACTIVE_PROVIDER_KEY) == provider:
            settings = {**(vault.settings or {})}
            settings.pop(ACTIVE_PROVIDER_KEY, None)
            vault.settings = settings
    else:
        user = await db.get(User, user_id)
        if user is not None and (user.settings or {}).get(ACTIVE_PROVIDER_KEY) == provider:
            settings = {**(user.settings or {})}
            settings.pop(ACTIVE_PROVIDER_KEY, None)
            user.settings = settings
    await db.commit()
    return ServiceResponse.ok(None)


async def resolve(
    db: AsyncSession, user_id: UUID, provider: str | None = None, vault_id: UUID | None = None
) -> ServiceResponse[tuple[AICredential, str]]:
    """The credential to use plus its decrypted key. Never leaves this module's
    callers — the key must not reach a response body.

    With a `vault_id`, the vault's own keys win: its active provider, else any
    key it has; only a vault with no key of its own falls through to the
    account's. With a `provider`, that provider in the narrowest scope that
    has it."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    credential: AICredential | None = None
    if vault_id is not None:
        wanted = provider or await _active_provider(db, user, vault_id)
        credential = await _credential(db, user_id, wanted, vault_id) if wanted else None
        if credential is None and provider is None:
            own = await _all_credentials(db, user_id, vault_id)
            credential = own[0] if own else None
    if credential is None:
        wanted = provider or (user.settings or {}).get(ACTIVE_PROVIDER_KEY)
        credential = await _credential(db, user_id, wanted) if wanted else None
    if credential is None and provider is None:
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


async def test_credential(
    db: AsyncSession, user_id: UUID, provider: str, vault_id: UUID | None = None
) -> ServiceResponse[dict[str, Any]]:
    """One cheap round-trip, so a wrong key is caught where it was pasted."""
    resolved = await resolve(db, user_id, provider, vault_id)
    if not resolved.success:
        return ServiceResponse.fail(resolved.error_code or "not_found", resolved.message)
    credential, key = resolved.data
    try:
        reply = await ai_providers.chat(
            provider=credential.provider,
            api_key=key,
            model=credential.model,
            base_url=credential.base_url,
            messages=[{"role": "user", "content": "Reply with the single word: ready"}],
            max_tokens=16,
        )
    except ProviderError as exc:
        return ServiceResponse.fail("validation_failed", str(exc))
    except Exception:  # network, DNS, timeout — never surface the raw text
        logger.warning("ai test failed for provider=%s", credential.provider, exc_info=True)
        return ServiceResponse.fail("validation_failed", "Could not reach the provider.")
    return ServiceResponse.ok({"provider": credential.provider, "model": credential.model, "reply": reply[:200]})


# ── Saved conversations ───────────────────────────────────────────────────────


def _title_from(message: str) -> str:
    """Name a thread after the question that opened it — a list of "New chat"
    rows is useless, and nobody titles a chat by hand."""
    first = message.strip().splitlines()[0] if message.strip() else ""
    return (first[:117] + "…") if len(first) > 118 else (first or "New chat")


async def _owned_conversation(
    db: AsyncSession, user_id: UUID, vault_id: UUID, conversation_id: UUID
) -> AIConversation | None:
    """Scoped by BOTH owner and vault: a conversation id from another vault must
    not be answerable here, since the tools would act on this one."""
    result = await db.execute(
        select(AIConversation).where(
            AIConversation.id == conversation_id,
            AIConversation.user_id == user_id,
            AIConversation.vault_id == vault_id,
        )
    )
    return result.scalar_one_or_none()


async def _conversation_messages(db: AsyncSession, conversation_id: UUID) -> list[AIMessage]:
    result = await db.execute(
        select(AIMessage)
        .where(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.created_at, AIMessage.id)
    )
    return list(result.scalars().all())


async def list_conversations(
    db: AsyncSession, user_id: UUID, vault_id: UUID, limit: int = 50
) -> ServiceResponse[list[dict[str, Any]]]:
    """This vault's chat threads, most recently used first."""
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.user_id == user_id, AIConversation.vault_id == vault_id)
        .order_by(AIConversation.updated_at.desc())
        .limit(min(limit, 200))
    )
    return ServiceResponse.ok(
        [
            {
                "id": str(c.id),
                "title": c.title,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in result.scalars().all()
        ]
    )


async def get_conversation(
    db: AsyncSession, user_id: UUID, vault_id: UUID, conversation_id: UUID
) -> ServiceResponse[dict[str, Any]]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    conversation = await _owned_conversation(db, user_id, vault_id, conversation_id)
    if conversation is None:
        return ServiceResponse.fail("not_found", "Conversation not found.")
    messages = await _conversation_messages(db, conversation.id)
    return ServiceResponse.ok(
        {
            "id": str(conversation.id),
            "title": conversation.title,
            "updated_at": conversation.updated_at.isoformat(),
            "messages": [{"role": m.role, "content": m.content, "actions": m.actions or []} for m in messages],
        }
    )


async def delete_conversation(
    db: AsyncSession, user_id: UUID, vault_id: UUID, conversation_id: UUID
) -> ServiceResponse[None]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    conversation = await _owned_conversation(db, user_id, vault_id, conversation_id)
    if conversation is None:
        return ServiceResponse.fail("not_found", "Conversation not found.")
    await db.delete(conversation)  # messages cascade at the DB level
    await db.commit()
    return ServiceResponse.ok(None)


async def rename_conversation(
    db: AsyncSession, user_id: UUID, vault_id: UUID, conversation_id: UUID, title: str
) -> ServiceResponse[dict[str, Any]]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    conversation = await _owned_conversation(db, user_id, vault_id, conversation_id)
    if conversation is None:
        return ServiceResponse.fail("not_found", "Conversation not found.")
    cleaned = title.strip()[:200]
    if not cleaned:
        return ServiceResponse.fail("validation_failed", "A title is required.")
    conversation.title = cleaned
    await db.commit()
    return ServiceResponse.ok({"id": str(conversation.id), "title": conversation.title})


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


TOOL_STATUS = {
    "search_notes": "Searching the vault…",
    "read_note": "Reading a note…",
    "create_note": "Writing a note…",
    "append_to_note": "Adding to a note…",
    "list_notes": "Listing notes…",
    "link_notes": "Linking notes…",
}


async def chat_with_vault_events(
    db: AsyncSession,
    user_id: UUID,
    vault_id: UUID,
    *,
    message: str,
    conversation_id: UUID | None = None,
    context: str = "",
) -> AsyncIterator[dict[str, Any]]:
    """`chat_with_vault` as a stream of events, for the live panel:

        {"type": "status", "text": "Searching the vault…"}   — a tool is running
        {"type": "delta",  "text": "…"}                       — reply text, as it arrives
        {"type": "done",   ...the same payload chat_with_vault returns}
        {"type": "error",  "message": "…"}                    — nothing was stored

    The transcript comes from the database, not from the client: the client
    sends one new message and the server appends it to the stored conversation.
    That keeps history intact across reloads and devices, and means a client
    cannot rewrite what the assistant was told earlier.

    The tool loop runs here, on the server, because the tools touch the
    database and the key must never leave it. It is bounded: at most
    MAX_TOOL_ROUNDS provider round-trips, so a model that keeps calling tools
    cannot spend the user's money in a loop.
    """
    message = (message or "").strip()
    if not message:
        yield {"type": "error", "code": "validation_failed", "message": "No message."}
        return
    if len(message) > MAX_MESSAGE_CHARS:
        yield {"type": "error", "code": "validation_failed", "message": "That message is too long."}
        return
    if await get_owned_vault(db, vault_id, user_id) is None:
        yield {"type": "error", "code": "not_found", "message": "Vault not found."}
        return

    # A new thread is created only once the turn has succeeded: the tools may
    # commit mid-turn (a note written), and a thread flushed before a failing
    # provider round would survive the rollback as an empty conversation.
    conversation: AIConversation | None = None
    if conversation_id is None:
        prior: list[dict[str, str]] = []
    else:
        found = await _owned_conversation(db, user_id, vault_id, conversation_id)
        if found is None:
            yield {"type": "error", "code": "not_found", "message": "Conversation not found."}
            return
        conversation = found
        prior = [{"role": m.role, "content": m.content} for m in await _conversation_messages(db, conversation.id)][
            -MAX_MESSAGES:
        ]

    messages = [*prior, {"role": "user", "content": message}]

    resolved = await resolve(db, user_id, vault_id=vault_id)
    if not resolved.success:
        yield {"type": "error", "code": resolved.error_code or "not_found", "message": resolved.message}
        return
    credential, key = resolved.data
    provider = credential.provider

    system = (
        "You are the assistant inside Nodum, a markdown knowledge base. "
        "You can search, read, create and extend the user's notes with the tools "
        "provided — use them rather than guessing what the vault contains. "
        "When you write a note, connect it to related ones with [[wikilinks]]. "
        "Answer in markdown, and be concise."
    )
    if context:
        system += f"\n\nThe note the user is looking at:\n{context}"

    history: list[Any] = [
        (
            ai_providers.user_message(provider, m["content"])
            if m["role"] == "user"
            else ai_providers.assistant_message(provider, m["content"])
        )
        for m in messages
    ]
    actions: list[dict[str, Any]] = []

    reply = ""
    try:
        for _ in range(ai_tools.MAX_TOOL_ROUNDS):
            turn: ai_providers.Turn | None = None
            streamed = ""
            async for item in ai_providers.stream_turn(
                provider=provider,
                api_key=key,
                model=credential.model,
                messages=history,
                system=system,
                tools=ai_tools.TOOLS,
                base_url=credential.base_url,
            ):
                if isinstance(item, ai_providers.Turn):
                    turn = item
                    break
                streamed += item
                yield {"type": "delta", "text": item}
            if turn is None:
                raise ProviderError("The provider closed the stream early.")
            if not turn.tool_calls:
                reply = turn.text
                break
            if streamed:
                # Text that came with tool calls is commentary the model wrote
                # before acting; the panel showed it live, and the final reply
                # replaces it — tell the panel to start the bubble over.
                yield {"type": "reset"}
            if turn.raw_message is not None:
                history.append(turn.raw_message)
            for call in turn.tool_calls:
                yield {"type": "status", "text": TOOL_STATUS.get(call.name, "Working…"), "tool": call.name}
                result = await ai_tools.run_tool(db, vault_id, user_id, call.name, call.arguments)
                recorded = ai_tools.describe(call.name, call.arguments, result)
                if recorded:
                    actions.append(recorded)
                    yield {"type": "action", "action": recorded}
                history.append(ai_providers.tool_result_message(provider, call, result))
        else:
            # Ran out of rounds with tools still pending: say so rather than
            # pretending nothing happened. Anything it already did is in
            # `actions` and has been written to the vault.
            reply = "I stopped after several steps. Ask me to continue if that was not enough."
            yield {"type": "delta", "text": reply}
    except ProviderError as exc:
        # The turn failed, so nothing is stored — the panel puts the question
        # back in the box and a retry starts from the same history.
        await db.rollback()
        yield {"type": "error", "code": "validation_failed", "message": str(exc)}
        return
    except Exception:
        logger.warning("ai vault chat failed for provider=%s", provider, exc_info=True)
        await db.rollback()
        yield {"type": "error", "code": "validation_failed", "message": "Could not reach the provider."}
        return

    if conversation is None:
        conversation = AIConversation(user_id=user_id, vault_id=vault_id, title=_title_from(message))
        db.add(conversation)
        await db.flush()
    db.add(AIMessage(conversation_id=conversation.id, role="user", content=message))
    db.add(AIMessage(conversation_id=conversation.id, role="assistant", content=reply, actions=actions))
    # Touch the thread so the history list sorts by real activity. (The tools
    # may have committed mid-turn, which leaves updated_at stale otherwise.)
    conversation.updated_at = datetime.now(UTC)
    await db.commit()
    yield {
        "type": "done",
        "conversation_id": str(conversation.id),
        "title": conversation.title,
        "reply": reply,
        "provider": provider,
        "model": credential.model,
        "actions": actions,
    }


async def chat_with_vault(
    db: AsyncSession,
    user_id: UUID,
    vault_id: UUID,
    *,
    message: str,
    conversation_id: UUID | None = None,
    context: str = "",
) -> ServiceResponse[dict[str, Any]]:
    """A chat turn that can search, read and write the vault — the whole
    answer at once. Same loop as the stream; see `chat_with_vault_events`."""
    final: dict[str, Any] | None = None
    async for event in chat_with_vault_events(
        db, user_id, vault_id, message=message, conversation_id=conversation_id, context=context
    ):
        if event["type"] == "error":
            return ServiceResponse.fail(event.get("code") or "validation_failed", event["message"])
        if event["type"] == "done":
            final = {k: v for k, v in event.items() if k != "type"}
    if final is None:
        return ServiceResponse.fail("validation_failed", "Could not reach the provider.")
    return ServiceResponse.ok(final)
