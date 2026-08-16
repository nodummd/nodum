"""Adapters for the AI providers a user can bring a key for.

One shape in, one shape out: a list of `{role, content}` messages and a system
prompt go in, an assistant string comes back. Each provider gets the smallest
correct request for a chat completion — no streaming yet, and no provider SDKs
(four SDKs for four thin HTTP calls is a poor trade, and `httpx` is already a
dependency).

Everything here talks to a THIRD PARTY with the USER'S key. So: never log the
key, never echo a provider's raw error body verbatim to the client (it can
contain the key), and always bound the request in time.
"""

from dataclasses import dataclass
from typing import Any

import httpx

from app.settings import get_settings


@dataclass(frozen=True)
class ProviderInfo:
    """What the settings UI needs to offer a provider."""

    id: str
    label: str
    default_model: str
    models: tuple[str, ...]
    key_url: str


# Model lists are a convenience, not a gate: the UI also accepts a typed model
# name, because providers ship new ones faster than we ship releases.
PROVIDERS: dict[str, ProviderInfo] = {
    "anthropic": ProviderInfo(
        id="anthropic",
        label="Claude (Anthropic)",
        default_model="claude-sonnet-4-5",
        models=("claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"),
        key_url="https://console.anthropic.com/settings/keys",
    ),
    "openai": ProviderInfo(
        id="openai",
        label="OpenAI",
        default_model="gpt-4.1",
        models=("gpt-4.1", "gpt-4.1-mini", "o4-mini"),
        key_url="https://platform.openai.com/api-keys",
    ),
    "gemini": ProviderInfo(
        id="gemini",
        label="Gemini (Google)",
        default_model="gemini-2.5-flash",
        models=("gemini-2.5-pro", "gemini-2.5-flash"),
        key_url="https://aistudio.google.com/app/apikey",
    ),
    "qwen": ProviderInfo(
        id="qwen",
        label="Qwen (Alibaba)",
        default_model="qwen-plus",
        models=("qwen-max", "qwen-plus", "qwen-turbo"),
        key_url="https://bailian.console.alibabacloud.com/",
    ),
}

_DEFAULT_BASE_URLS = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
}


class ProviderError(RuntimeError):
    """A provider refused or failed. The message is safe to show the user."""


def base_url_for(provider: str, override: str | None) -> str:
    return (override or _DEFAULT_BASE_URLS[provider]).rstrip("/")


def _safe_error(provider: str, response: httpx.Response) -> ProviderError:
    """Map a provider failure to something we can show without leaking the key.

    Provider error bodies quote the request — including the key — often enough
    that echoing them is a real disclosure risk. Status codes are enough to say
    something useful.
    """
    if response.status_code in (401, 403):
        return ProviderError("The provider rejected the API key. Check it in Settings → AI.")
    if response.status_code == 404:
        return ProviderError("The provider does not know that model. Pick another in Settings → AI.")
    if response.status_code == 429:
        return ProviderError("The provider is rate-limiting this key. Try again shortly.")
    if response.status_code >= 500:
        return ProviderError(f"{provider} is having trouble right now ({response.status_code}).")
    return ProviderError(f"The provider rejected the request ({response.status_code}).")


async def chat(
    *,
    provider: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    system: str = "",
    base_url: str | None = None,
    max_tokens: int = 2048,
) -> str:
    """Send one turn and return the assistant's reply text."""
    if provider not in PROVIDERS:
        raise ProviderError(f"Unknown provider: {provider}")
    url_root = base_url_for(provider, base_url)
    timeout = httpx.Timeout(float(get_settings().AI_REQUEST_TIMEOUT))

    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "anthropic":
            payload: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": messages,
            }
            if system:
                payload["system"] = system
            response = await client.post(
                f"{url_root}/v1/messages",
                json=payload,
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
            if response.status_code >= 400:
                raise _safe_error(provider, response)
            blocks = response.json().get("content", [])
            return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()

        if provider == "gemini":
            contents = [
                {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                for m in messages
            ]
            payload = {"contents": contents}
            if system:
                payload["systemInstruction"] = {"parts": [{"text": system}]}
            response = await client.post(
                f"{url_root}/models/{model}:generateContent",
                json=payload,
                headers={"x-goog-api-key": api_key},
            )
            if response.status_code >= 400:
                raise _safe_error(provider, response)
            candidates = response.json().get("candidates", [])
            if not candidates:
                return ""
            parts = candidates[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in parts).strip()

        # openai and qwen both speak the OpenAI chat-completions shape; Qwen's
        # compatible-mode endpoint is why it needs no adapter of its own.
        chat_messages = ([{"role": "system", "content": system}] if system else []) + messages
        response = await client.post(
            f"{url_root}/chat/completions",
            json={"model": model, "messages": chat_messages, "max_tokens": max_tokens},
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if response.status_code >= 400:
            raise _safe_error(provider, response)
        choices = response.json().get("choices", [])
        if not choices:
            return ""
        return (choices[0].get("message", {}).get("content") or "").strip()
