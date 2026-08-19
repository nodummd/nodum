"""Adapters for the AI providers a user can bring a key for.

One shape in, one shape out: a list of `{role, content}` messages and a system
prompt go in, an assistant string comes back. Each provider gets the smallest
correct request for a chat completion — streamed when the panel wants it — and no provider SDKs
(four SDKs for four thin HTTP calls is a poor trade, and `httpx` is already a
dependency).

Everything here talks to a THIRD PARTY with the USER'S key. So: never log the
key, never echo a provider's raw error body verbatim to the client (it can
contain the key), and always bound the request in time.
"""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from app.settings import get_settings
from app.utils.url_guard import UnsafeUrlError, assert_safe_url


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


async def _checked_base_url(provider: str, override: str | None) -> str:
    """Resolve the provider root, refusing an override that points somewhere
    the server must not reach.

    Enforced here and not only in save_credential: a save-time check misses
    every credential stored before the guard existed, and a hostname is free to
    resolve differently on the second lookup. Built-in defaults skip the check
    — they are ours, and resolving them on every call would add a DNS round
    trip to the hot path.
    """
    if not override:
        return _DEFAULT_BASE_URLS[provider].rstrip("/")
    try:
        await assert_safe_url(override, allow_private=get_settings().AI_ALLOW_PRIVATE_BASE_URLS)
    except UnsafeUrlError as exc:
        raise ProviderError(str(exc)) from exc
    return override.rstrip("/")


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


@dataclass
class ToolCall:
    """A provider-neutral request to run one of our vault tools."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class Turn:
    """One provider response: some text, and/or some tool calls."""

    text: str
    tool_calls: list[ToolCall]
    # The assistant message exactly as the provider wants it echoed back in the
    # next request — shapes differ enough that reconstructing it is error-prone.
    raw_message: Any = None


def _tools_for(provider: str, tools: list[dict[str, Any]]) -> Any:
    """Translate our neutral tool declarations into the provider's shape."""
    if provider == "anthropic":
        return [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools]
    if provider == "gemini":
        return [
            {
                "functionDeclarations": [
                    {"name": t["name"], "description": t["description"], "parameters": t["parameters"]} for t in tools
                ]
            }
        ]
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            },
        }
        for t in tools
    ]


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
    url_root = await _checked_base_url(provider, base_url)
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


async def turn(
    *,
    provider: str,
    api_key: str,
    model: str,
    messages: list[Any],
    system: str,
    tools: list[dict[str, Any]],
    base_url: str | None = None,
    max_tokens: int = 2048,
) -> Turn:
    """One round-trip WITH tools available.

    `messages` here is the provider's own conversation array (built up across
    rounds by the caller), not our neutral shape: once tool results are in the
    history, every provider wants them back in its own format.
    """
    if provider not in PROVIDERS:
        raise ProviderError(f"Unknown provider: {provider}")
    url_root = await _checked_base_url(provider, base_url)
    timeout = httpx.Timeout(float(get_settings().AI_REQUEST_TIMEOUT))

    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "anthropic":
            payload: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": messages,
                "tools": _tools_for(provider, tools),
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
            body = response.json()
            blocks = body.get("content", [])
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
            calls = [
                ToolCall(id=b.get("id", ""), name=b.get("name", ""), arguments=b.get("input") or {})
                for b in blocks
                if b.get("type") == "tool_use"
            ]
            return Turn(text=text, tool_calls=calls, raw_message={"role": "assistant", "content": blocks})

        if provider == "gemini":
            payload = {"contents": messages, "tools": _tools_for(provider, tools)}
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
                return Turn(text="", tool_calls=[], raw_message=None)
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if "text" in p).strip()
            calls = [
                # Gemini has no call ids; the function name is the correlator.
                ToolCall(
                    id=p["functionCall"].get("name", ""),
                    name=p["functionCall"].get("name", ""),
                    arguments=p["functionCall"].get("args") or {},
                )
                for p in parts
                if "functionCall" in p
            ]
            return Turn(text=text, tool_calls=calls, raw_message={"role": "model", "parts": parts})

        # openai / qwen
        response = await client.post(
            f"{url_root}/chat/completions",
            json={
                "model": model,
                "messages": ([{"role": "system", "content": system}] if system else []) + messages,
                "max_tokens": max_tokens,
                "tools": _tools_for(provider, tools),
            },
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if response.status_code >= 400:
            raise _safe_error(provider, response)
        choices = response.json().get("choices", [])
        if not choices:
            return Turn(text="", tool_calls=[], raw_message=None)
        message = choices[0].get("message", {}) or {}
        calls = []
        for call in message.get("tool_calls") or []:
            function = call.get("function", {}) or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except json.JSONDecodeError:
                arguments = {}
            calls.append(ToolCall(id=call.get("id", ""), name=function.get("name", ""), arguments=arguments))
        return Turn(text=(message.get("content") or "").strip(), tool_calls=calls, raw_message=message)


# ── Streaming ────────────────────────────────────────────────────────────────


async def _sse_data(response: httpx.Response) -> AsyncIterator[str]:
    """Yield the `data:` payloads of an SSE stream, one event at a time."""
    buffer: list[str] = []
    async for line in response.aiter_lines():
        if line == "":
            if buffer:
                yield "\n".join(buffer)
                buffer = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("data:"):
            buffer.append(line[5:].lstrip())
    if buffer:
        yield "\n".join(buffer)


async def stream_turn(
    *,
    provider: str,
    api_key: str,
    model: str,
    messages: list[Any],
    system: str,
    tools: list[dict[str, Any]],
    base_url: str | None = None,
    max_tokens: int = 2048,
) -> AsyncIterator[str | Turn]:
    """`turn`, streamed: yields text deltas as they arrive and, last, the Turn.

    Tool calls stream too (as argument fragments) and are assembled before the
    Turn is yielded, so a turn that ends in tool calls produces no text deltas
    worth showing and the caller simply runs the tools. The raw assistant
    message is rebuilt in the provider's shape so the next round can echo it.
    """
    if provider not in PROVIDERS:
        raise ProviderError(f"Unknown provider: {provider}")
    url_root = await _checked_base_url(provider, base_url)
    timeout = httpx.Timeout(float(get_settings().AI_REQUEST_TIMEOUT))

    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "anthropic":
            payload: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": messages,
                "tools": _tools_for(provider, tools),
                "stream": True,
            }
            if system:
                payload["system"] = system
            async with client.stream(
                "POST",
                f"{url_root}/v1/messages",
                json=payload,
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    raise _safe_error(provider, response)
                blocks: list[dict[str, Any]] = []
                partial_json: dict[int, str] = {}
                async for data in _sse_data(response):
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    kind = event.get("type")
                    if kind == "content_block_start":
                        block = dict(event.get("content_block") or {})
                        index = int(event.get("index", len(blocks)))
                        while len(blocks) <= index:
                            blocks.append({})
                        if block.get("type") == "tool_use":
                            block["input"] = {}
                            partial_json[index] = ""
                        elif block.get("type") == "text":
                            block["text"] = block.get("text", "")
                        blocks[index] = block
                    elif kind == "content_block_delta":
                        index = int(event.get("index", 0))
                        delta = event.get("delta") or {}
                        if index >= len(blocks):
                            continue
                        if delta.get("type") == "text_delta":
                            piece = delta.get("text", "")
                            blocks[index]["text"] = blocks[index].get("text", "") + piece
                            if piece:
                                yield piece
                        elif delta.get("type") == "input_json_delta":
                            partial_json[index] = partial_json.get(index, "") + delta.get("partial_json", "")
                    elif kind == "content_block_stop":
                        index = int(event.get("index", 0))
                        if index in partial_json:
                            try:
                                blocks[index]["input"] = json.loads(partial_json[index] or "{}")
                            except json.JSONDecodeError:
                                blocks[index]["input"] = {}
                    elif kind == "error":
                        raise ProviderError("The provider reported an error mid-stream.")
                text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
                calls = [
                    ToolCall(id=b.get("id", ""), name=b.get("name", ""), arguments=b.get("input") or {})
                    for b in blocks
                    if b.get("type") == "tool_use"
                ]
                yield Turn(text=text, tool_calls=calls, raw_message={"role": "assistant", "content": blocks})
                return

        if provider == "gemini":
            payload = {"contents": messages, "tools": _tools_for(provider, tools)}
            if system:
                payload["systemInstruction"] = {"parts": [{"text": system}]}
            async with client.stream(
                "POST",
                f"{url_root}/models/{model}:streamGenerateContent?alt=sse",
                json=payload,
                headers={"x-goog-api-key": api_key},
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    raise _safe_error(provider, response)
                parts: list[dict[str, Any]] = []
                text_buf = ""
                async for data in _sse_data(response):
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    candidates = chunk.get("candidates") or []
                    if not candidates:
                        continue
                    for part in candidates[0].get("content", {}).get("parts", []) or []:
                        if "text" in part:
                            piece = part.get("text", "")
                            text_buf += piece
                            if piece:
                                yield piece
                        elif "functionCall" in part:
                            parts.append(part)
                if text_buf:
                    parts.insert(0, {"text": text_buf})
                calls = [
                    ToolCall(
                        id=p["functionCall"].get("name", ""),
                        name=p["functionCall"].get("name", ""),
                        arguments=p["functionCall"].get("args") or {},
                    )
                    for p in parts
                    if "functionCall" in p
                ]
                raw = {"role": "model", "parts": parts} if parts else None
                yield Turn(text=text_buf.strip(), tool_calls=calls, raw_message=raw)
                return

        # openai / qwen
        async with client.stream(
            "POST",
            f"{url_root}/chat/completions",
            json={
                "model": model,
                "messages": ([{"role": "system", "content": system}] if system else []) + messages,
                "max_tokens": max_tokens,
                "tools": _tools_for(provider, tools),
                "stream": True,
            },
            headers={"Authorization": f"Bearer {api_key}"},
        ) as response:
            if response.status_code >= 400:
                await response.aread()
                raise _safe_error(provider, response)
            text_buf = ""
            pending_calls: dict[int, dict[str, Any]] = {}
            async for data in _sse_data(response):
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                piece = delta.get("content") or ""
                if piece:
                    text_buf += piece
                    yield piece
                for call in delta.get("tool_calls") or []:
                    index = int(call.get("index", 0))
                    slot = pending_calls.setdefault(
                        index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
                    )
                    if call.get("id"):
                        slot["id"] = call["id"]
                    function = call.get("function") or {}
                    if function.get("name"):
                        slot["function"]["name"] += function["name"]
                    if function.get("arguments"):
                        slot["function"]["arguments"] += function["arguments"]
            calls = []
            for index in sorted(pending_calls):
                slot = pending_calls[index]
                try:
                    arguments = json.loads(slot["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    arguments = {}
                calls.append(ToolCall(id=slot["id"], name=slot["function"]["name"], arguments=arguments))
            raw: dict[str, Any] = {"role": "assistant", "content": text_buf or None}
            if pending_calls:
                raw["tool_calls"] = [pending_calls[i] for i in sorted(pending_calls)]
            yield Turn(text=text_buf.strip(), tool_calls=calls, raw_message=raw)


def user_message(provider: str, text: str) -> Any:
    """The provider's shape for a user turn."""
    if provider == "gemini":
        return {"role": "user", "parts": [{"text": text}]}
    return {"role": "user", "content": text}


def assistant_message(provider: str, text: str) -> Any:
    if provider == "gemini":
        return {"role": "model", "parts": [{"text": text}]}
    return {"role": "assistant", "content": text}


def tool_result_message(provider: str, call: ToolCall, result: dict[str, Any]) -> Any:
    """The provider's shape for handing a tool's output back to the model."""
    payload = json.dumps(result)
    if provider == "anthropic":
        return {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": call.id, "content": payload}],
        }
    if provider == "gemini":
        return {
            "role": "user",
            "parts": [{"functionResponse": {"name": call.name, "response": result}}],
        }
    return {"role": "tool", "tool_call_id": call.id, "content": payload}
