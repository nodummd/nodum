"""Account recovery and closure — reset a forgotten password, delete an account.

Both are gated on a one-time code mailed to the address on file, so both live
here rather than in auth_service: what they have in common is proof of the
mailbox, not of the password.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import User
from app.models.vaults import Vault
from app.services import email_verification_service as otp
from app.services.service_response import ServiceResponse
from app.utils.password_utils import hash_password_async

logger = get_logger("account")


async def request_password_reset(db: AsyncSession, *, email: str) -> ServiceResponse[None]:
    """Mail a reset code, if there is anything to mail it to.

    Always succeeds from the caller's point of view. This endpoint is
    unauthenticated, so a truthful "no such account" would turn it into an
    address oracle — and one that says which of a leaked list are real users.
    """
    user = await db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_active:
        logger.info("password_reset_requested_for_unknown_address")
        return ServiceResponse.ok(None)

    issued = await otp.issue_code(db, user, purpose=otp.PASSWORD_RESET)
    if not issued.success:
        # Swallowed on purpose. Reporting a cooldown here would undo the
        # neutral answer above: ask twice in quick succession and only a real
        # address would come back 429. The operator still sees it in the logs.
        logger.info("password_reset_code_not_sent", user_id=str(user.id), reason=issued.error_code)
        return ServiceResponse.ok(None)
    await db.commit()
    logger.info("password_reset_code_sent", user_id=str(user.id))
    return ServiceResponse.ok(None)


async def reset_password(db: AsyncSession, *, email: str, code: str, new_password: str) -> ServiceResponse[User]:
    """Set a new password from a mailed code, and cut every existing session.

    Sessions go because a reset is what someone does when they suspect they
    have lost control of the account; leaving the intruder's refresh token
    alive would defeat the whole exercise. The caller mints the new one.
    """
    from app.services.auth_service import revoke_existing_sessions

    user = await db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_active:
        return ServiceResponse.fail("invalid_code", "That code is not valid. Request a new one.")

    checked = await otp.check_code(db, user, code=code, purpose=otp.PASSWORD_RESET)
    if not checked.success:
        return ServiceResponse.fail(checked.error_code, checked.message)

    user.password_hash = await hash_password_async(new_password)
    # Reaching a code in the inbox proves the address as surely as signup does,
    # so an account that never finished verifying is verified by this.
    user.email_verified = True
    await revoke_existing_sessions(db, user.id, "password_reset")
    await db.commit()
    logger.info("password_reset_completed", user_id=str(user.id))
    return ServiceResponse.ok(user)


async def request_account_deletion(db: AsyncSession, user_id: UUID) -> ServiceResponse[None]:
    """Mail the code that authorises deleting this account."""
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return ServiceResponse.fail("unauthorized", "Account is not available.")

    # Cooldown applies: this endpoint is reachable by anyone holding a session,
    # and forcing would let one spam the owner's inbox (and the sending quota)
    # at whatever the rate limiter allows. A repeat inside the window is told
    # to wait, and the code already sent still works.
    issued = await otp.issue_code(db, user, purpose=otp.ACCOUNT_DELETE)
    if not issued.success:
        return issued
    await db.commit()
    logger.info("account_deletion_code_sent", user_id=str(user.id))
    return ServiceResponse.ok(None)


async def delete_account(db: AsyncSession, user_id: UUID, *, code: str) -> ServiceResponse[None]:
    """Delete the account, its vaults, and the files behind them.

    Deliberately not gated on the password as well: accounts created through
    Google sign-in carry a random one their owner has never seen, and locking
    them out of closing their own account is worse than the marginal defence a
    second factor buys here — the code already proves the mailbox.
    """
    user = await db.get(User, user_id)
    if user is None:
        return ServiceResponse.fail("unauthorized", "Account is not available.")

    checked = await otp.check_code(db, user, code=code, purpose=otp.ACCOUNT_DELETE)
    if not checked.success:
        return ServiceResponse.fail(checked.error_code, checked.message)

    vault_ids = list((await db.execute(select(Vault.id).where(Vault.user_id == user.id))).scalars())

    # Object storage first, while the rows that name the vaults still exist. A
    # DB cascade cannot reach into the bucket, and orphaned attachments are
    # exactly the data someone closing an account expects to be gone.
    for vault_id in vault_ids:
        await _purge_vault_objects(vault_id)

    from app.utils.cache_utils import cache_delete, vault_graph_key, vault_tree_key

    for vault_id in vault_ids:
        await cache_delete(vault_tree_key(vault_id), vault_graph_key(vault_id))

    await db.delete(user)  # vaults, notes, sessions, bookmarks, AI rows all cascade
    await db.commit()
    logger.info("account_deleted", user_id=str(user_id), vaults=len(vault_ids))
    return ServiceResponse.ok(None)


async def _purge_vault_objects(vault_id: UUID) -> None:
    """Delete everything under one vault's S3 prefix, in 1000-key batches.

    Best-effort: a bucket that refuses must not strand the account in a
    half-deleted state, so failures are logged and the DB delete proceeds.
    """
    import asyncio

    from app.core.s3 import get_s3_client
    from app.settings import get_settings

    settings = get_settings()
    prefix = f"vaults/{vault_id}/"

    def purge() -> int:
        client = get_s3_client()
        removed = 0
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
            keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if not keys:
                continue
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": keys})
            removed += len(keys)
        return removed

    try:
        removed = await asyncio.to_thread(purge)
        if removed:
            logger.info("vault_objects_purged", vault_id=str(vault_id), objects=removed)
    except Exception as exc:  # closure must not hinge on the bucket
        logger.warning("vault_objects_purge_failed", vault_id=str(vault_id), error=str(exc)[:200])
