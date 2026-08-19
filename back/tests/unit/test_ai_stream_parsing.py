"""`ai_providers.stream_turn` assembles text deltas and tool calls from each
provider's streaming format. Canned SSE bodies, no network."""

import json

import httpx
import pytest

from app.services import ai_providers

FAKE_KEY = "fake-provider-key-not-real"


def _sse(events: list[str]) -> bytes:
    return "".join(f"data: {e}\n\n" for e in events).encode()


def _patch_transport(monkeypatch: pytest.MonkeyPatch, body: bytes, content_type: str = "text/event-stream") -> list:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=body, headers={"content-type": content_type})

    real = httpx.AsyncClient

    def client(**kw):
        return real(transport=httpx.MockTransport(handler), **kw)

    monkeypatch.setattr(ai_providers.httpx, "AsyncClient", client)
    return seen


async def _collect(**kw) -> tuple[list[str], ai_providers.Turn]:
    deltas: list[str] = []
    turn = None
    async for item in ai_providers.stream_turn(**kw):
        if isinstance(item, ai_providers.Turn):
            turn = item
        else:
            deltas.append(item)
    assert turn is not None
    return deltas, turn


async def test_openai_stream_text_and_tool_call_fragments(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _sse(
        [
            json.dumps({"choices": [{"delta": {"role": "assistant", "content": "Hel"}}]}),
            json.dumps({"choices": [{"delta": {"content": "lo"}}]}),
            json.dumps(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_1",
                                        "function": {"name": "search_notes", "arguments": '{"qu'},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ),
            json.dumps(
                {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'ery": "x"}'}}]}}]}
            ),
            json.dumps({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}),
            "[DONE]",
        ]
    )
    seen = _patch_transport(monkeypatch, body)
    deltas, turn = await _collect(
        provider="openai", api_key=FAKE_KEY, model="gpt-4.1", messages=[], system="s", tools=[]
    )
    assert deltas == ["Hel", "lo"]
    assert turn.text == "Hello"
    assert [(c.id, c.name, c.arguments) for c in turn.tool_calls] == [("call_1", "search_notes", {"query": "x"})]
    assert turn.raw_message["tool_calls"][0]["function"]["arguments"] == '{"query": "x"}'
    assert json.loads(seen[0].content)["stream"] is True


async def test_anthropic_stream_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _sse(
        [
            json.dumps({"type": "message_start", "message": {}}),
            json.dumps({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json.dumps({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Let me "}}),
            json.dumps({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "look."}}),
            json.dumps({"type": "content_block_stop", "index": 0}),
            json.dumps(
                {
                    "type": "content_block_start",
                    "index": 1,
                    "content_block": {"type": "tool_use", "id": "tu_1", "name": "read_note", "input": {}},
                }
            ),
            json.dumps(
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "input_json_delta", "partial_json": '{"title":'},
                }
            ),
            json.dumps(
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "input_json_delta", "partial_json": ' "Home"}'},
                }
            ),
            json.dumps({"type": "content_block_stop", "index": 1}),
            json.dumps({"type": "message_stop"}),
        ]
    )
    _patch_transport(monkeypatch, body)
    deltas, turn = await _collect(
        provider="anthropic", api_key=FAKE_KEY, model="claude-sonnet-4-5", messages=[], system="", tools=[]
    )
    assert "".join(deltas) == "Let me look."
    assert turn.text == "Let me look."
    assert [(c.id, c.name, c.arguments) for c in turn.tool_calls] == [("tu_1", "read_note", {"title": "Home"})]
    assert [b["type"] for b in turn.raw_message["content"]] == ["text", "tool_use"]


async def test_gemini_stream_parts(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _sse(
        [
            json.dumps({"candidates": [{"content": {"parts": [{"text": "Sure, "}]}}]}),
            json.dumps({"candidates": [{"content": {"parts": [{"text": "done."}]}}]}),
            json.dumps(
                {
                    "candidates": [
                        {"content": {"parts": [{"functionCall": {"name": "create_note", "args": {"title": "T"}}}]}}
                    ]
                }
            ),
        ]
    )
    _patch_transport(monkeypatch, body)
    deltas, turn = await _collect(
        provider="gemini", api_key=FAKE_KEY, model="gemini-2.5-flash", messages=[], system="", tools=[]
    )
    assert deltas == ["Sure, ", "done."]
    assert turn.text == "Sure, done."
    assert turn.tool_calls[0].name == "create_note" and turn.tool_calls[0].arguments == {"title": "T"}
    assert turn.raw_message["parts"][0] == {"text": "Sure, done."}


async def test_provider_error_status_is_mapped_not_leaked(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b'{"error":"bad key sk-secret"}')

    real = httpx.AsyncClient
    monkeypatch.setattr(
        ai_providers.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )
    with pytest.raises(ai_providers.ProviderError) as exc:
        await _collect(provider="openai", api_key=FAKE_KEY, model="m", messages=[], system="", tools=[])
    assert "rejected the API key" in str(exc.value) and "sk-secret" not in str(exc.value)
