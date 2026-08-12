"""Whole-vault publishing — /s/{slug} public sites."""

import re
import secrets
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import limits
from app.models.publications import VaultPublication
from app.models.vaults import Note
from app.services.service_response import ServiceResponse
from app.services.vault_service import get_owned_vault


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "vault"
    return f"{base[:40]}-{secrets.token_urlsafe(4).lower().replace('_', '').replace('-', '')[:6]}"


def _note_is_public(note_properties: dict | None) -> bool:
    return (note_properties or {}).get("publish") is not False


async def publish_vault(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    vault = await get_owned_vault(db, vault_id, user_id)
    if vault is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    pub = await db.scalar(select(VaultPublication).where(VaultPublication.vault_id == vault_id))
    if pub is None:
        pub = VaultPublication(vault_id=vault_id, slug=_slugify(vault.name), enabled=True)
        db.add(pub)
    else:
        pub.enabled = True
    await db.commit()
    await db.refresh(pub)
    return ServiceResponse.ok({"slug": pub.slug, "enabled": True})


async def unpublish_vault(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[None]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    pub = await db.scalar(select(VaultPublication).where(VaultPublication.vault_id == vault_id))
    if pub is not None:
        pub.enabled = False
        await db.commit()
    return ServiceResponse.ok(None)


async def publish_status(db: AsyncSession, vault_id: UUID, user_id: UUID) -> ServiceResponse[dict[str, Any]]:
    if await get_owned_vault(db, vault_id, user_id) is None:
        return ServiceResponse.fail("not_found", "Vault not found.")
    pub = await db.scalar(select(VaultPublication).where(VaultPublication.vault_id == vault_id))
    if pub is None or not pub.enabled:
        return ServiceResponse.ok({"enabled": False, "slug": pub.slug if pub else None})
    return ServiceResponse.ok({"enabled": True, "slug": pub.slug})


async def _enabled_publication(db: AsyncSession, slug: str) -> VaultPublication | None:
    pub = await db.scalar(select(VaultPublication).where(VaultPublication.slug == slug))
    return pub if pub is not None and pub.enabled else None


async def public_site(db: AsyncSession, slug: str) -> ServiceResponse[dict[str, Any]]:
    """Site index: vault name + nav of publishable notes."""
    pub = await _enabled_publication(db, slug)
    if pub is None:
        return ServiceResponse.fail("not_found", "Site not found.")

    from app.models.vaults import Vault

    vault = await db.scalar(select(Vault).where(Vault.id == pub.vault_id))
    rows = (
        await db.execute(
            select(Note.title, Note.path, Note.properties)
            .where(Note.vault_id == pub.vault_id)
            .order_by(Note.path)
            .limit(limits.MAX_TREE_ITEMS)
        )
    ).all()
    notes = [{"title": title, "path": path} for title, path, properties in rows if _note_is_public(properties)]
    return ServiceResponse.ok({"slug": slug, "vault_name": vault.name if vault else "Vault", "notes": notes})


async def public_note(db: AsyncSession, slug: str, path: str) -> ServiceResponse[dict[str, Any]]:
    pub = await _enabled_publication(db, slug)
    if pub is None:
        return ServiceResponse.fail("not_found", "Site not found.")
    note = await db.scalar(select(Note).where(Note.vault_id == pub.vault_id, Note.path == path))
    if note is None or not _note_is_public(note.properties):
        return ServiceResponse.fail("not_found", "Note not found.")
    return ServiceResponse.ok(
        {
            "title": note.title,
            "path": note.path,
            "content": note.content,
            "updated_at": note.updated_at.isoformat(),
        }
    )
