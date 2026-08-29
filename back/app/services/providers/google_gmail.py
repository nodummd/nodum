"""Gmail → notes, one per thread. SELF-HOSTED ONLY.

`gmail.readonly` is on Google's *restricted* list, and so is `gmail.metadata` —
which is the trap, because it reads like the cautious option while carrying the
identical compliance burden *and* blocking `format=full` and the `q` search
parameter, so you lose bodies and server-side date windowing for nothing. A
hosted multi-user deployment requesting either owes a CASA assessment by an
authorised lab, renewed annually. An operator running Nodum for themselves is
covered by Google's personal-use exemption and owes none of it.

Hence `GOOGLE_SYNC_GMAIL_ENABLED`, off by default, and the registry refusing to
expose this adapter unless it is set.

## Threads, not messages

A thread is the stable unit a person thinks in; messages are immutable appends
to it. One note per thread means a 40-message conversation is one place in the
graph rather than forty, and new messages append rather than rewrite — which
also means a reply arriving cannot disturb what the user wrote underneath.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any

import httpx

from app.services.daily_note_service import format_date
from app.services.importers.base import tag_name
from app.services.importers.html_md import html_to_markdown

from .base import CursorInvalid, FetchContext, ProviderError, SyncPage, SyncRecord, escape_remote_text

API = "https://gmail.googleapis.com/gmail/v1/users/me"
STREAM = "gmail:messages"

DEFAULT_BACKFILL_DAYS = 90
#: Threads fetched per page. Each is its own API call, so this bounds both the
#: page's wall time and the damage a rate limit can do mid-walk.
THREADS_PER_PAGE = 25

#: Labels that describe Gmail's own plumbing rather than anything the user
#: chose. Tagging notes with these would add noise to every single note.
_BORING_LABELS = {"UNREAD", "IMPORTANT", "CATEGORY_PERSONAL", "SENT", "DRAFT", "CHAT"}
# Parsed by hand rather than by regex. The obvious pattern — an optional
# quoted name followed by an optional bracketed address — backtracks on a bare
# "dan@example.com" and hands back name="da", email="n@example.com", because
# the greedy name group gives up exactly as many characters as the address
# needs. Two explicit cases are longer and cannot do that.


class GoogleGmailAdapter:
    id = "google_gmail"
    name = "Gmail"
    scopes = ("https://www.googleapis.com/auth/gmail.readonly",)

    def streams(self, connection_settings: dict[str, Any]) -> list[str]:
        return [STREAM]

    def cursor_params(self, stream: str, settings: dict[str, Any]) -> dict[str, Any]:
        gmail = settings.get("gmail") or {}
        # The label filter is part of what the cursor means: widening it later
        # must trigger a resync, or the newly included threads are never seen.
        return {"labels": sorted(gmail.get("labels") or ["INBOX"])}

    async def fetch(self, ctx: FetchContext) -> SyncPage:
        return await (self._incremental(ctx) if ctx.cursor_token and not ctx.backfill else self._backfill(ctx))

    # ── first walk ───────────────────────────────────────────────────────

    async def _backfill(self, ctx: FetchContext) -> SyncPage:
        gmail = ctx.settings.get("gmail") or {}
        days = int(gmail.get("backfill_days") or DEFAULT_BACKFILL_DAYS)
        labels = gmail.get("labels") or ["INBOX"]

        params = {
            "maxResults": str(THREADS_PER_PAGE),
            "q": f"newer_than:{days}d",
            "labelIds": labels[0] if labels else "INBOX",
        }
        if ctx.page_token:
            params["pageToken"] = ctx.page_token

        listing = await self._get("/threads", ctx.access_token, params)
        thread_ids = [str(t.get("id")) for t in (listing.get("threads") or []) if t.get("id")]
        records = [r for r in [await self._thread(tid, ctx) for tid in thread_ids] if r]

        next_page = str(listing.get("nextPageToken") or "")
        cursor = ""
        if not next_page:
            # Bootstrap the incremental cursor from getProfile rather than from
            # the newest message: one quota unit instead of twenty, and it
            # returns the value directly rather than by inference.
            profile = await self._get("/profile", ctx.access_token, {})
            cursor = str(profile.get("historyId") or "")

        return SyncPage(records=records, next_page_token=next_page, next_cursor=cursor, done=not next_page)

    # ── incremental ──────────────────────────────────────────────────────

    async def _incremental(self, ctx: FetchContext) -> SyncPage:
        params = {"startHistoryId": ctx.cursor_token, "maxResults": "200"}
        if ctx.page_token:
            params["pageToken"] = ctx.page_token

        payload = await self._get("/history", ctx.access_token, params)

        # One thread may appear in many history entries; fetch each once.
        touched: list[str] = []
        for entry in payload.get("history") or []:
            for bucket in ("messagesAdded", "messagesDeleted", "labelsAdded", "labelsRemoved"):
                for change in entry.get(bucket) or []:
                    thread_id = str((change.get("message") or {}).get("threadId") or "")
                    if thread_id and thread_id not in touched:
                        touched.append(thread_id)

        records = [r for r in [await self._thread(tid, ctx) for tid in touched[:THREADS_PER_PAGE]] if r]
        next_page = str(payload.get("nextPageToken") or "")
        return SyncPage(
            records=records,
            next_page_token=next_page,
            next_cursor="" if next_page else str(payload.get("historyId") or ""),
            done=not next_page,
        )

    # ── one thread → one note ────────────────────────────────────────────

    async def _thread(self, thread_id: str, ctx: FetchContext) -> SyncRecord | None:
        gmail = ctx.settings.get("gmail") or {}
        store_bodies = bool(gmail.get("store_bodies"))
        fmt = "full" if store_bodies else "metadata"

        try:
            payload = await self._get(f"/threads/{thread_id}", ctx.access_token, {"format": fmt})
        except ProviderError as exc:
            # A thread deleted between listing and fetching is normal, not a
            # failure — the whole page must not die for it.
            if exc.error_class == "not_found":
                return SyncRecord(external_id=thread_id, kind="tombstone")
            raise

        messages = payload.get("messages") or []
        if not messages:
            return SyncRecord(external_id=thread_id, kind="tombstone")

        subject = ""
        participants: list[str] = []
        labels: set[str] = set()
        blocks: list[str] = []
        first_at: datetime | None = None
        last_at: datetime | None = None

        for message in messages:
            headers = {
                str(h.get("name", "")).lower(): str(h.get("value", ""))
                for h in ((message.get("payload") or {}).get("headers") or [])
            }
            if not subject:
                subject = escape_remote_text(headers.get("subject", "").strip())
            name, _address = _split_address(headers.get("from", ""))
            if name and name not in participants:
                participants.append(escape_remote_text(name))
            labels.update(str(label) for label in (message.get("labelIds") or []))

            sent = _epoch(message.get("internalDate"))
            if sent:
                first_at = sent if first_at is None else min(first_at, sent)
                last_at = sent if last_at is None else max(last_at, sent)

            heading = (
                f"## {sent.strftime('%Y-%m-%d') if sent else 'unknown date'} — {escape_remote_text(name or 'Unknown')}"
            )
            if store_bodies:
                body = escape_remote_text(_body_text(message.get("payload") or {}))[:8000]
                quoted = "\n".join(f"> {line}" if line.strip() else ">" for line in body.split("\n"))
                blocks.append(f"{heading}\n\n{quoted}" if body else heading)
            else:
                blocks.append(heading)

        subject = subject or "(no subject)"
        first_at = first_at or datetime.now(UTC)
        tags = sorted(
            f"gmail/{tag_name(label.lower().replace('category_', ''))}"
            for label in labels
            if label not in _BORING_LABELS and not label.startswith("Label_")
        )

        front = [
            "---",
            "source: gmail",
            "type: thread",
            f"thread_id: {thread_id}",
            f'subject: "{subject.replace(chr(34), chr(39))[:200]}"',
            f"created: {first_at.isoformat()}",
        ]
        if last_at:
            front.append(f"updated: {last_at.isoformat()}")
        if participants:
            front.append("participants:")
            front.extend(f"  - {p}" for p in participants[:20])
        if tags:
            front.append("tags:")
            front.extend(f"  - {t}" for t in tags[:20])
        front.append(f"url: https://mail.google.com/mail/u/0/#inbox/{thread_id}")
        front.append("---")

        lines = ["\n".join(front), "", f"# {subject}", ""]
        lines.append(f"Thread started [[{format_date(ctx.daily_format, first_at)}]]")
        lines.append("")
        lines.extend(["\n\n".join(blocks)])
        if not store_bodies:
            lines.append("")
            lines.append("*Message bodies are not stored for this connection.*")

        return SyncRecord(
            external_id=thread_id,
            title=subject,
            folder=f"Mail/{first_at.strftime('%Y/%m')}",
            body="\n".join(lines).rstrip() + "\n",
            external_updated_at=last_at,
            external_version=int(payload.get("historyId") or 0),
            payload={"messages": len(messages)},
            wants_notes=tuple(participants[:10]),
        )

    async def _get(self, path: str, token: str, params: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {token}"})
        if resp.status_code == 404:
            # On /history specifically this means the startHistoryId is older
            # than Gmail's retention and the only recovery is a full re-walk.
            if path == "/history":
                raise CursorInvalid("Gmail history is older than the stored cursor; re-syncing from scratch.")
            raise ProviderError("Not found", error_class="not_found")
        if resp.status_code in (401, 403):
            raise ProviderError(resp.text[:200], error_class="auth")
        if resp.status_code == 429:
            raise ProviderError("Gmail rate limit", error_class="rate_limit", retry_after=60)
        if resp.status_code >= 500:
            raise ProviderError(f"Gmail returned {resp.status_code}", error_class="provider_5xx")
        if resp.status_code >= 400:
            raise ProviderError(f"Gmail returned {resp.status_code}: {resp.text[:200]}")
        return dict(resp.json())


# ── helpers ─────────────────────────────────────────────────────────────────


def _split_address(raw: str) -> tuple[str, str]:
    """ "Amara Osei" <a@x.com> -> ("Amara Osei", "a@x.com")."""
    text = (raw or "").strip()
    if not text:
        return ("", "")
    if "<" in text and ">" in text and text.index("<") < text.rindex(">"):
        name = text[: text.index("<")].strip().strip('"').strip()
        email = text[text.index("<") + 1 : text.rindex(">")].strip()
    else:
        name, email = "", text.strip("<>").strip()
    if not name:
        name = email.split("@")[0] if "@" in email else email
    return (name, email)


def _epoch(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=UTC)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _body_text(payload: dict[str, Any]) -> str:
    """Prefer text/plain; fall back to converting the HTML part."""
    plain = _find_part(payload, "text/plain")
    if plain:
        return plain
    html = _find_part(payload, "text/html")
    return html_to_markdown(html) if html else ""


def _find_part(payload: dict[str, Any], mime: str, depth: int = 0) -> str:
    if depth > 8:
        return ""
    if payload.get("mimeType") == mime:
        data = (payload.get("body") or {}).get("data")
        if data:
            try:
                return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            except (ValueError, TypeError):
                return ""
    for part in payload.get("parts") or []:
        found = _find_part(part, mime, depth + 1)
        if found:
            return found
    return ""
