"""Email verification — issue a one-time code, check it, mark the address good.

Production issues a random six-digit code and mails it through the provider
chain. Every other environment issues the fixed ``EMAIL_OTP_DEV_CODE`` and
sends nothing, so the flow is identical to production's in every respect except
where the code comes from — which is what makes it testable without a mailbox.
"""

import hmac
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import EmailVerification, User
from app.services.email_service import send_email
from app.services.service_response import ServiceResponse
from app.settings import get_settings

logger = get_logger("email_verification")


def verification_required() -> bool:
    return get_settings().EMAIL_VERIFICATION_REQUIRED


def _hash_code(code: str) -> str:
    """HMAC, not a bare digest: six digits is a 10^6 space, so a plain SHA of
    it is a lookup table. The app secret is what makes a dump useless."""
    settings = get_settings()
    return hmac.new(settings.SECRET_KEY.encode(), code.encode(), sha256).hexdigest()


def _new_code() -> str:
    """Random in production, fixed everywhere else (see module docstring)."""
    settings = get_settings()
    if settings.ENVIRONMENT == "production":
        return f"{secrets.randbelow(1_000_000):06d}"
    return settings.EMAIL_OTP_DEV_CODE


def _email_body(name: str, code: str, ttl_minutes: int) -> tuple[str, str]:
    greeting = f"Hi {name}," if name else "Hi,"
    text = (
        f"{greeting}\n\n"
        f"Your Nodum verification code is {code}.\n\n"
        f"It expires in {ttl_minutes} minutes. If you didn't create a Nodum "
        f"account, you can ignore this email — nothing was set up.\n\n"
        f"— Nodum\n"
    )
    html = f"""\
<!doctype html>
<html><body style="margin:0;padding:32px;background:#06060b;font-family:ui-sans-serif,system-ui,sans-serif;color:#ece9f5">
  <div style="max-width:480px;margin:0 auto">
    <p style="font-size:15px;line-height:1.6;color:#9c97b0;margin:0 0 24px">{greeting}</p>
    <p style="font-size:15px;line-height:1.6;color:#9c97b0;margin:0 0 24px">
      Your Nodum verification code is
    </p>
    <p style="font-family:ui-monospace,monospace;font-size:34px;letter-spacing:.32em;
              color:#ece9f5;margin:0 0 24px">{code}</p>
    <p style="font-size:14px;line-height:1.6;color:#8a86a0;margin:0 0 8px">
      It expires in {ttl_minutes} minutes.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#8a86a0;margin:0">
      If you didn't create a Nodum account, ignore this email — nothing was set up.
    </p>
  </div>
</body></html>
"""
    return html, text


async def issue_code(db: AsyncSession, user: User, *, force: bool = False) -> ServiceResponse[None]:
    """Create (or replace) this user's pending code and send it.

    ``force`` skips the resend cooldown; signup uses it, the resend endpoint
    does not. The caller commits.
    """
    settings = get_settings()
    now = datetime.now(UTC)

    if not force:
        latest = await db.scalar(
            select(EmailVerification)
            .where(EmailVerification.user_id == user.id)
            .order_by(EmailVerification.created_at.desc())
            .limit(1)
        )
        if latest is not None:
            age = (now - latest.created_at).total_seconds()
            if age < settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS:
                wait = int(settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS - age)
                return ServiceResponse.fail("rate_limited", f"A code was just sent. Try again in {wait} seconds.")

    # One pending code per user: a replaced code must stop working immediately.
    await db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))

    code = _new_code()
    record = EmailVerification(
        user_id=user.id,
        code_hash=_hash_code(code),
        expires_at=now + timedelta(minutes=settings.EMAIL_OTP_TTL_MINUTES),
    )

    if settings.ENVIRONMENT == "production":
        html, text = _email_body(user.name, code, settings.EMAIL_OTP_TTL_MINUTES)
        provider = await send_email(
            to=user.email,
            subject="Your Nodum verification code",
            html=html,
            text=text,
        )
        if provider is None:
            # Nothing to verify against: say so rather than stranding the user
            # on a code screen no email will ever satisfy.
            return ServiceResponse.fail(
                "email_delivery_failed",
                "We couldn't send your verification email. Please try again in a moment.",
            )
        record.delivered_via = provider
    else:
        record.delivered_via = "dev"
        logger.info("email_verification_dev_code", user_id=str(user.id), code=code)

    db.add(record)
    return ServiceResponse.ok(None)


async def verify(db: AsyncSession, *, email: str, code: str) -> ServiceResponse[User]:
    """Check a submitted code and mark the address verified. The caller commits."""
    settings = get_settings()
    email = email.strip().lower()
    code = code.strip()

    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        # Same shape as a wrong code — the endpoint is unauthenticated, so it
        # must not say which addresses have accounts.
        return ServiceResponse.fail("invalid_code", "That code is not valid. Request a new one.")
    if user.email_verified:
        return ServiceResponse.ok(user)

    record = await db.scalar(
        select(EmailVerification)
        .where(EmailVerification.user_id == user.id, EmailVerification.consumed_at.is_(None))
        .order_by(EmailVerification.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if record is None:
        return ServiceResponse.fail("invalid_code", "That code is not valid. Request a new one.")

    now = datetime.now(UTC)
    if record.expires_at <= now:
        return ServiceResponse.fail("code_expired", "That code has expired. Request a new one.")
    if record.attempts >= settings.EMAIL_OTP_MAX_ATTEMPTS:
        return ServiceResponse.fail("too_many_attempts", "Too many incorrect attempts. Request a new code.")

    if not hmac.compare_digest(record.code_hash, _hash_code(code)):
        record.attempts += 1
        await db.commit()
        remaining = max(0, settings.EMAIL_OTP_MAX_ATTEMPTS - record.attempts)
        detail = f" {remaining} attempts left." if remaining else " Request a new code."
        return ServiceResponse.fail("invalid_code", f"That code is not correct.{detail}")

    record.consumed_at = now
    user.email_verified = True
    logger.info("email_verified", user_id=str(user.id))
    return ServiceResponse.ok(user)
