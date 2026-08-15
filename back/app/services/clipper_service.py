"""Web Clipper — scoped tokens and page capture.

A browser extension cannot hold the user's session: it lives in a different
origin, has no refresh cookie, and its storage is readable by anything with
the profile. So clipping uses its own long-lived token that can ONLY create
notes, is stored hashed, and can be revoked without touching the session.
"""

import hashlib
import secrets
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.vaults import Vault
from app.services.folder_service import ensure_folder_path
from app.services.note_service import create_note
from app.services.service_response import ServiceResponse
from app.utils.path_utils import validate_segment

# Where the hash lives on the user row (JSONB — no migration needed).
_SETTINGS_KEY = "clipperTokenHash"
_TOKEN_BYTES = 32


def _hash(token: str) -> str:
    """SHA-256 is right here: the token is 256 bits of CSPRNG output, so it has
    no guessable structure for a slow KDF to protect against."""
    return hashlib.sha256(token.encode()).hexdigest()


async def issue_token(db: AsyncSession, user_id: UUID) -> ServiceResponse[dict[str, str]]:
    """Mint a new clipper token, returning the plaintext exactly once."""
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    # Replace any previous token — issuing is also how you rotate.
    user.settings = {**(user.settings or {}), _SETTINGS_KEY: _hash(token)}
    await db.commit()
    return ServiceResponse.ok({"token": token})


async def revoke_token(db: AsyncSession, user_id: UUID) -> ServiceResponse[None]:
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("not_found", "User not found.")
    settings = {**(user.settings or {})}
    settings.pop(_SETTINGS_KEY, None)
    user.settings = settings
    await db.commit()
    return ServiceResponse.ok(None)


async def has_token(db: AsyncSession, user_id: UUID) -> bool:
    user = await db.get(User, user_id)
    return bool((user.settings or {}).get(_SETTINGS_KEY)) if user else False


async def user_for_token(db: AsyncSession, token: str) -> User | None:
    """Resolve a presented token to its owner, in constant time per candidate."""
    if not token:
        return None
    digest = _hash(token)
    # The hash is unique per user, so an equality lookup is exact; compare_digest
    # guards the final comparison against timing analysis.
    rows = await db.execute(select(User).where(User.is_active.is_(True)))
    for user in rows.scalars():
        stored = (user.settings or {}).get(_SETTINGS_KEY)
        if isinstance(stored, str) and secrets.compare_digest(stored, digest):
            return user
    return None


def _frontmatter(url: str, title: str, tags: list[str], clipped_at: datetime) -> str:
    lines = ["---", f'source: "{url}"', f'title: "{title}"', f"clipped: {clipped_at.date().isoformat()}"]
    if tags:
        lines.append("tags:")
        lines.extend(f"  - {t}" for t in tags)
    lines.append("---")
    return "\n".join(lines)


async def clip(
    db: AsyncSession,
    user: User,
    *,
    url: str,
    title: str,
    markdown: str,
    vault_id: UUID | None = None,
    folder: str | None = None,
    tags: list[str] | None = None,
) -> ServiceResponse[dict[str, Any]]:
    """Turn a captured page into a note, with provenance in the frontmatter."""
    target = vault_id
    if target is None:
        # No vault chosen → the user's first vault, so a fresh install works.
        first = await db.scalar(select(Vault).where(Vault.user_id == user.id).order_by(Vault.created_at))
        if first is None:
            return ServiceResponse.fail("not_found", "You have no vaults yet.")
        target = first.id

    clean_title = (title or "Untitled clip").strip()[:200]
    if validate_segment(clean_title):
        # Titles come from arbitrary page <title>s — strip what paths forbid.
        clean_title = "".join(c for c in clean_title if c not in '*"\\/<>:|?#^[]').strip() or "Untitled clip"

    folder_id = None
    if folder:
        folder_id = await ensure_folder_path(db, target, user.id, folder)

    body = f"{_frontmatter(url, clean_title, tags or [], datetime.now())}\n\n{markdown.strip()}\n"
    created = await create_note(db, target, user.id, title=clean_title, folder_id=folder_id, content=body)
    if not created.success or created.data is None:
        return ServiceResponse.fail(created.error_code or "validation_failed", created.message or "Clip failed.")
    return ServiceResponse.ok(
        {"id": str(created.data.id), "title": created.data.title, "vault_id": str(target)}
    )
