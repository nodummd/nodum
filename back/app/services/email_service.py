"""Outbound email — one message, several providers, first one that takes it wins.

Why a chain rather than a single provider: every free tier here is a daily or
monthly quota, and a quota rejection looks exactly like an outage to the caller
(HTTP 4xx/5xx). Walking an ordered list therefore does two useful things at
once — it survives one provider having a bad hour, and it adds the free tiers
together, because the request that trips Brevo's daily cap is simply handed to
the next name on the list.

Free tiers at the time of writing (2026-08), which is why the shipped default
order is brevo → mailjet → resend → mailgun → smtp:

    brevo    300/day  (~9,000/month), no expiry — the largest sustained tier
    mailjet  6,000/month, capped at 200/day
    resend   3,000/month (~100/day)
    mailgun  100/day
    smtp     whatever the operator points it at (SES, Postmark, a relay…)

Nothing here is Nodum-specific: `send_email` is the whole surface.
"""

import asyncio
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any

import httpx

from app.core.logging import get_logger
from app.settings import get_settings

logger = get_logger("email")

#: Providers this module knows how to talk to, in the default failover order.
KNOWN_PROVIDERS = ("brevo", "mailjet", "resend", "mailgun", "smtp")


@dataclass(slots=True)
class Message:
    to: str
    subject: str
    html: str
    text: str


def _sender() -> tuple[str, str]:
    settings = get_settings()
    return settings.EMAIL_FROM_NAME, settings.EMAIL_FROM_ADDRESS


def configured_providers() -> list[str]:
    """The chain, filtered down to the ones that actually have credentials.

    An operator who lists a provider but forgets its key gets it skipped (and
    said so at boot) rather than a run-time failure on the first signup.
    """
    settings = get_settings()
    raw = [p.strip().lower() for p in settings.EMAIL_PROVIDERS.split(",") if p.strip()]
    return [p for p in raw if p in KNOWN_PROVIDERS and _has_credentials(p)]


def _has_credentials(provider: str) -> bool:
    s = get_settings()
    match provider:
        case "brevo":
            return bool(s.BREVO_API_KEY)
        case "mailjet":
            return bool(s.MAILJET_API_KEY and s.MAILJET_API_SECRET)
        case "resend":
            return bool(s.RESEND_API_KEY)
        case "mailgun":
            return bool(s.MAILGUN_API_KEY and s.MAILGUN_DOMAIN)
        case "smtp":
            return bool(s.SMTP_HOST)
        case _:
            return False


async def send_email(*, to: str, subject: str, html: str, text: str) -> str | None:
    """Deliver one message. Returns the provider that accepted it, or None.

    Never raises: callers decide what a delivery failure means for them.
    """
    message = Message(to=to, subject=subject, html=html, text=text)
    providers = configured_providers()
    if not providers:
        logger.error("email_no_provider_configured", to=_redact(to))
        return None

    for provider in providers:
        try:
            await _SENDERS[provider](message)
        except Exception as exc:
            logger.warning(
                "email_provider_failed",
                provider=provider,
                to=_redact(to),
                error=str(exc)[:200],
            )
            continue
        logger.info("email_sent", provider=provider, to=_redact(to))
        return provider

    logger.error("email_all_providers_failed", to=_redact(to), tried=",".join(providers))
    return None


def _redact(address: str) -> str:
    """Log which mailbox failed without writing the address into the logs."""
    local, _, domain = address.partition("@")
    head = local[:2] if len(local) > 2 else local[:1]
    return f"{head}***@{domain}" if domain else "***"


def _raise_for_status(provider: str, response: httpx.Response) -> None:
    if response.status_code >= 300:
        raise RuntimeError(f"{provider} responded {response.status_code}: {response.text[:200]}")


async def _send_brevo(message: Message) -> None:
    settings = get_settings()
    name, address = _sender()
    async with httpx.AsyncClient(timeout=settings.EMAIL_TIMEOUT_SECONDS) as client:
        response = await client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": settings.BREVO_API_KEY, "accept": "application/json"},
            json={
                "sender": {"name": name, "email": address},
                "to": [{"email": message.to}],
                "subject": message.subject,
                "htmlContent": message.html,
                "textContent": message.text,
            },
        )
    _raise_for_status("brevo", response)


async def _send_mailjet(message: Message) -> None:
    settings = get_settings()
    name, address = _sender()
    async with httpx.AsyncClient(timeout=settings.EMAIL_TIMEOUT_SECONDS) as client:
        response = await client.post(
            "https://api.mailjet.com/v3.1/send",
            auth=(settings.MAILJET_API_KEY, settings.MAILJET_API_SECRET),
            json={
                "Messages": [
                    {
                        "From": {"Email": address, "Name": name},
                        "To": [{"Email": message.to}],
                        "Subject": message.subject,
                        "TextPart": message.text,
                        "HTMLPart": message.html,
                    }
                ]
            },
        )
    _raise_for_status("mailjet", response)


async def _send_resend(message: Message) -> None:
    settings = get_settings()
    name, address = _sender()
    async with httpx.AsyncClient(timeout=settings.EMAIL_TIMEOUT_SECONDS) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={
                "from": f"{name} <{address}>",
                "to": [message.to],
                "subject": message.subject,
                "html": message.html,
                "text": message.text,
            },
        )
    _raise_for_status("resend", response)


async def _send_mailgun(message: Message) -> None:
    settings = get_settings()
    name, address = _sender()
    # EU-hosted domains live on a different host; sending to the wrong one is a
    # 401 that reads like a bad key.
    host = "api.eu.mailgun.net" if settings.MAILGUN_REGION.lower() == "eu" else "api.mailgun.net"
    async with httpx.AsyncClient(timeout=settings.EMAIL_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"https://{host}/v3/{settings.MAILGUN_DOMAIN}/messages",
            auth=("api", settings.MAILGUN_API_KEY),
            data={
                "from": f"{name} <{address}>",
                "to": message.to,
                "subject": message.subject,
                "text": message.text,
                "html": message.html,
            },
        )
    _raise_for_status("mailgun", response)


async def _send_smtp(message: Message) -> None:
    """Generic SMTP relay — the escape hatch for SES, Postmark, or a self-run MTA.

    smtplib is blocking, so it runs in a worker thread; adding an async SMTP
    dependency for the last link in a fallback chain is not worth it.
    """
    settings = get_settings()
    name, address = _sender()

    mail = EmailMessage()
    mail["From"] = f"{name} <{address}>"
    mail["To"] = message.to
    mail["Subject"] = message.subject
    mail.set_content(message.text)
    mail.add_alternative(message.html, subtype="html")

    def deliver() -> None:
        timeout = settings.EMAIL_TIMEOUT_SECONDS
        if settings.SMTP_USE_SSL:
            client: smtplib.SMTP = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout)
        else:
            client = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout)
        with client:
            if settings.SMTP_STARTTLS and not settings.SMTP_USE_SSL:
                client.starttls()
            if settings.SMTP_USERNAME:
                client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            client.send_message(mail)

    await asyncio.to_thread(deliver)


_SENDERS: dict[str, Any] = {
    "brevo": _send_brevo,
    "mailjet": _send_mailjet,
    "resend": _send_resend,
    "mailgun": _send_mailgun,
    "smtp": _send_smtp,
}
