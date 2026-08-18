"""The email failover chain: order, skipping, and what happens when all fail.

No network — the per-provider senders are swapped for recorders. What is under
test is the walk, not the HTTP calls.
"""

import pytest

from app.services import email_service
from app.settings import get_settings


@pytest.fixture
def creds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give every provider a credential so the chain is fully populated."""
    settings = get_settings()
    for field, value in (
        ("BREVO_API_KEY", "brevo-key"),
        ("MAILJET_API_KEY", "mj-key"),
        ("MAILJET_API_SECRET", "mj-secret"),
        ("RESEND_API_KEY", "resend-key"),
        ("MAILGUN_API_KEY", "mg-key"),
        ("MAILGUN_DOMAIN", "mg.example.com"),
        ("SMTP_HOST", "smtp.example.com"),
    ):
        monkeypatch.setattr(settings, field, value)


def _record(calls: list[str], name: str, *, fail: bool = False):
    async def sender(_message: email_service.Message) -> None:
        calls.append(name)
        if fail:
            raise RuntimeError(f"{name} said no")

    return sender


@pytest.mark.usefixtures("creds")
async def test_first_provider_that_accepts_wins_and_the_rest_are_untouched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    monkeypatch.setitem(email_service._SENDERS, "brevo", _record(calls, "brevo"))
    monkeypatch.setitem(email_service._SENDERS, "mailjet", _record(calls, "mailjet"))

    used = await email_service.send_email(to="a@b.test", subject="s", html="<p>h</p>", text="t")

    assert used == "brevo"
    assert calls == ["brevo"]


@pytest.mark.usefixtures("creds")
async def test_a_failing_provider_hands_the_message_to_the_next_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """This is also how a spent free tier behaves — a quota rejection is just
    another 4xx, so the next provider's allowance picks the message up."""
    calls: list[str] = []
    monkeypatch.setitem(email_service._SENDERS, "brevo", _record(calls, "brevo", fail=True))
    monkeypatch.setitem(email_service._SENDERS, "mailjet", _record(calls, "mailjet", fail=True))
    monkeypatch.setitem(email_service._SENDERS, "resend", _record(calls, "resend"))

    used = await email_service.send_email(to="a@b.test", subject="s", html="<p>h</p>", text="t")

    assert used == "resend"
    assert calls == ["brevo", "mailjet", "resend"]


@pytest.mark.usefixtures("creds")
async def test_all_providers_failing_reports_failure_rather_than_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in email_service.KNOWN_PROVIDERS:
        monkeypatch.setitem(email_service._SENDERS, name, _record([], name, fail=True))

    assert await email_service.send_email(to="a@b.test", subject="s", html="h", text="t") is None


async def test_providers_without_credentials_are_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    for field in ("BREVO_API_KEY", "MAILJET_API_KEY", "RESEND_API_KEY", "MAILGUN_API_KEY", "SMTP_HOST"):
        monkeypatch.setattr(settings, field, "")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "resend-key")

    assert email_service.configured_providers() == ["resend"]


async def test_no_provider_configured_is_a_failure_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    for field in ("BREVO_API_KEY", "MAILJET_API_KEY", "RESEND_API_KEY", "MAILGUN_API_KEY", "SMTP_HOST"):
        monkeypatch.setattr(settings, field, "")

    assert await email_service.send_email(to="a@b.test", subject="s", html="h", text="t") is None


def test_recipients_are_redacted_in_logs() -> None:
    assert email_service._redact("someone@example.com") == "so***@example.com"
    assert email_service._redact("a@example.com") == "a***@example.com"
