"""One-time email codes — issue, check, consume.

Three flows share this: confirming a new signup, resetting a forgotten
password, and deleting an account. They differ only in the copy of the email
and in the ``purpose`` recorded on the row, and that purpose is what keeps them
apart — a code mailed to reset a password must never delete an account.

Production issues a random six-digit code and mails it through the provider
chain. Every other environment issues the fixed ``EMAIL_OTP_DEV_CODE`` and
sends nothing, so the flow is identical to production's in every respect except
where the code comes from — which is what makes it testable without a mailbox.
"""

import hmac
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import EmailVerification, User
from app.services.email_service import send_email
from app.services.service_response import ServiceResponse
from app.settings import get_settings

logger = get_logger("email_verification")

Purpose = Literal["signup", "password_reset", "account_delete"]

SIGNUP: Purpose = "signup"
PASSWORD_RESET: Purpose = "password_reset"
ACCOUNT_DELETE: Purpose = "account_delete"


def verification_required() -> bool:
    return get_settings().EMAIL_VERIFICATION_REQUIRED


def _hash_code(code: str, purpose: Purpose) -> str:
    """HMAC, not a bare digest: six digits is a 10^6 space, so a plain SHA of
    it is a lookup table. The app secret is what makes a dump useless.

    The purpose is part of the message, so even identical codes issued for two
    flows hash differently — belt and braces alongside the column filter."""
    settings = get_settings()
    return hmac.new(settings.SECRET_KEY.encode(), f"{purpose}:{code}".encode(), sha256).hexdigest()


def _new_code() -> str:
    """Random in production, fixed everywhere else (see module docstring)."""
    settings = get_settings()
    if settings.ENVIRONMENT == "production":
        return f"{secrets.randbelow(1_000_000):06d}"
    return settings.EMAIL_OTP_DEV_CODE


# ── Email copy, per purpose ──────────────────────────────────────────────────

_COPY: dict[str, dict[str, str]] = {
    SIGNUP: {
        "subject": "Your Nodum verification code",
        "lead": "Your Nodum verification code is",
        "footer": "If you didn't create a Nodum account, ignore this email — nothing was set up.",
    },
    PASSWORD_RESET: {
        "subject": "Reset your Nodum password",
        "lead": "Use this code to set a new Nodum password:",
        "footer": (
            "If you didn't ask to reset your password, ignore this email — your "
            "current password still works and nothing has changed."
        ),
    },
    ACCOUNT_DELETE: {
        "subject": "Confirm deleting your Nodum account",
        "lead": "Use this code to delete your Nodum account and everything in it:",
        "footer": (
            "If you didn't ask to delete your account, ignore this email and change "
            "your password — someone may be signed in as you."
        ),
    },
}


def _email_body(name: str, code: str, purpose: Purpose, ttl_minutes: int) -> tuple[str, str]:
    copy = _COPY[purpose]
    greeting = f"Hi {name}," if name else "Hi,"
    text = f"{greeting}\n\n{copy['lead']} {code}\n\nIt expires in {ttl_minutes} minutes. {copy['footer']}\n\n— Nodum\n"
    html = f"""\
<!doctype html>
<html><body style="margin:0;padding:32px;background:#06060b;font-family:ui-sans-serif,system-ui,sans-serif;color:#ece9f5">
  <div style="max-width:480px;margin:0 auto">
    <p style="font-size:15px;line-height:1.6;color:#9c97b0;margin:0 0 24px">{greeting}</p>
    <p style="font-size:15px;line-height:1.6;color:#9c97b0;margin:0 0 24px">{copy["lead"]}</p>
    <p style="font-family:ui-monospace,monospace;font-size:34px;letter-spacing:.32em;
              color:#ece9f5;margin:0 0 24px">{code}</p>
    <p style="font-size:14px;line-height:1.6;color:#8a86a0;margin:0 0 8px">
      It expires in {ttl_minutes} minutes.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#8a86a0;margin:0">{copy["footer"]}</p>
  </div>
</body></html>
"""
    return html, text


# ── Issue ────────────────────────────────────────────────────────────────────


async def issue_code(
    db: AsyncSession, user: User, *, purpose: Purpose = SIGNUP, force: bool = False
) -> ServiceResponse[None]:
    """Create (or replace) this user's pending code for one purpose and send it.

    ``force`` skips the resend cooldown; the flows that send a code as part of a
    deliberate action (signing up, asking to delete) use it, the plain "send it
    again" endpoints do not. The caller commits.
    """
    settings = get_settings()
    now = datetime.now(UTC)

    if not force:
        latest = await db.scalar(
            select(EmailVerification)
            .where(EmailVerification.user_id == user.id, EmailVerification.purpose == purpose)
            .order_by(EmailVerification.created_at.desc())
            .limit(1)
        )
        if latest is not None:
            age = (now - latest.created_at).total_seconds()
            if age < settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS:
                wait = int(settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS - age)
                return ServiceResponse.fail("rate_limited", f"A code was just sent. Try again in {wait} seconds.")

    # One pending code per user per purpose: a replaced code must stop working
    # immediately, but a reset code must not wipe a pending signup code.
    await db.execute(
        delete(EmailVerification).where(EmailVerification.user_id == user.id, EmailVerification.purpose == purpose)
    )

    code = _new_code()
    record = EmailVerification(
        user_id=user.id,
        purpose=purpose,
        code_hash=_hash_code(code, purpose),
        expires_at=now + timedelta(minutes=settings.EMAIL_OTP_TTL_MINUTES),
    )

    if settings.ENVIRONMENT == "production":
        html, text = _email_body(user.name, code, purpose, settings.EMAIL_OTP_TTL_MINUTES)
        provider = await send_email(to=user.email, subject=_COPY[purpose]["subject"], html=html, text=text)
        if provider is None:
            # Nothing to verify against: say so rather than stranding the user
            # on a code screen no email will ever satisfy.
            return ServiceResponse.fail(
                "email_delivery_failed",
                "We couldn't send that email. Please try again in a moment.",
            )
        record.delivered_via = provider
    else:
        record.delivered_via = "dev"
        logger.info("otp_dev_code", user_id=str(user.id), purpose=purpose, code=code)

    db.add(record)
    return ServiceResponse.ok(None)


# ── Check ────────────────────────────────────────────────────────────────────


async def check_code(
    db: AsyncSession, user: User, *, code: str, purpose: Purpose
) -> ServiceResponse[EmailVerification]:
    """Validate a submitted code and mark it consumed. The caller commits.

    A wrong code is committed here on purpose: the attempt counter is the only
    thing standing between a 10^6 space and a patient script.
    """
    settings = get_settings()
    record = await db.scalar(
        select(EmailVerification)
        .where(
            EmailVerification.user_id == user.id,
            EmailVerification.purpose == purpose,
            EmailVerification.consumed_at.is_(None),
        )
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

    if not hmac.compare_digest(record.code_hash, _hash_code(code.strip(), purpose)):
        record.attempts += 1
        await db.commit()
        remaining = max(0, settings.EMAIL_OTP_MAX_ATTEMPTS - record.attempts)
        detail = f" {remaining} attempts left." if remaining else " Request a new code."
        return ServiceResponse.fail("invalid_code", f"That code is not correct.{detail}")

    record.consumed_at = now
    return ServiceResponse.ok(record)


async def verify(db: AsyncSession, *, email: str, code: str) -> ServiceResponse[User]:
    """Signup's flavour: check the code and mark the address verified."""
    email = email.strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        # Same shape as a wrong code — the endpoint is unauthenticated, so it
        # must not say which addresses have accounts.
        return ServiceResponse.fail("invalid_code", "That code is not valid. Request a new one.")
    if user.email_verified:
        return ServiceResponse.ok(user)

    checked = await check_code(db, user, code=code, purpose=SIGNUP)
    if not checked.success:
        return ServiceResponse.fail(checked.error_code, checked.message)

    user.email_verified = True
    logger.info("email_verified", user_id=str(user.id))
    return ServiceResponse.ok(user)
