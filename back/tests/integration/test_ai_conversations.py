"""Saved AI chat history.

The transcript is the user's work: it must survive the browser, belong to one
vault, and never be readable by anyone else. The provider is stubbed by
patching the adapter — these tests are about storage, not about HTTP shapes.
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.services import ai_providers, ai_service


async def _signup(client: AsyncClient, prefix: str) -> dict:
    creds = {
        "email": f"{prefix}-{uuid.uuid4().hex[:12]}@nodumtest.dev",
        "password": "s3cure-Password!",
        "name": "AI Tester",
    }
    resp = await client.post("/api/v1/auth/signup", json=creds)
    assert resp.status_code == 201, resp.text
    client.cookies.clear()
    return resp.json()["data"]


def _auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
async def account(client: AsyncClient) -> dict:
    tokens = await _signup(client, "aiconv")
    await client.put(
        "/api/v1/ai/credentials",
        json={"provider": "openai", "api_key": "sk-stub-conv", "model": "stub"},
        headers=_auth(tokens),
    )
    vaults = await client.get("/api/v1/vaults", headers=_auth(tokens))
    return {"tokens": tokens, "vault_id": vaults.json()["data"][0]["id"]}


@pytest.fixture
def stub_provider(monkeypatch: pytest.MonkeyPatch):
    """Answer every turn with plain text, and record what was sent."""
    sent: list[list[Any]] = []

    async def fake_turn(**kwargs: Any) -> ai_providers.Turn:
        sent.append(kwargs["messages"])
        return ai_providers.Turn(text="stub reply", tool_calls=[], raw_message=None)

    monkeypatch.setattr(ai_providers, "turn", fake_turn)
    return sent


async def test_a_turn_creates_a_conversation_titled_after_the_question(
    client: AsyncClient, account: dict, stub_provider: list
) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    resp = await client.post(
        f"/api/v1/ai/vaults/{vault}/chat",
        json={"message": "What is spaced repetition?"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["reply"] == "stub reply"
    assert data["title"] == "What is spaced repetition?"

    listed = await client.get(f"/api/v1/ai/vaults/{vault}/conversations", headers=headers)
    assert [c["id"] for c in listed.json()["data"]] == [data["conversation_id"]]

    full = await client.get(f"/api/v1/ai/vaults/{vault}/conversations/{data['conversation_id']}", headers=headers)
    messages = full.json()["data"]["messages"]
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "What is spaced repetition?"),
        ("assistant", "stub reply"),
    ]


async def test_the_stored_history_is_what_the_provider_sees_next_turn(
    client: AsyncClient, account: dict, stub_provider: list
) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    first = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "first"}, headers=headers)
    conversation_id = first.json()["data"]["conversation_id"]

    await client.post(
        f"/api/v1/ai/vaults/{vault}/chat",
        json={"message": "second", "conversation_id": conversation_id},
        headers=headers,
    )
    # The client sent one message; the server rebuilt the whole transcript.
    second_call = stub_provider[1]
    assert [m["content"] for m in second_call] == ["first", "stub reply", "second"]

    full = await client.get(f"/api/v1/ai/vaults/{vault}/conversations/{conversation_id}", headers=headers)
    assert len(full.json()["data"]["messages"]) == 4


async def test_a_second_chat_is_a_separate_thread(client: AsyncClient, account: dict, stub_provider: list) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    one = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "alpha"}, headers=headers)
    two = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "beta"}, headers=headers)
    assert one.json()["data"]["conversation_id"] != two.json()["data"]["conversation_id"]

    listed = (await client.get(f"/api/v1/ai/vaults/{vault}/conversations", headers=headers)).json()["data"]
    # Most recent first.
    assert [c["title"] for c in listed] == ["beta", "alpha"]


async def test_rename_and_delete(client: AsyncClient, account: dict, stub_provider: list) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    created = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "throwaway"}, headers=headers)
    conversation_id = created.json()["data"]["conversation_id"]

    renamed = await client.patch(
        f"/api/v1/ai/vaults/{vault}/conversations/{conversation_id}",
        json={"title": "Reading list"},
        headers=headers,
    )
    assert renamed.json()["data"]["title"] == "Reading list"

    removed = await client.delete(f"/api/v1/ai/vaults/{vault}/conversations/{conversation_id}", headers=headers)
    assert removed.status_code == 200
    listed = await client.get(f"/api/v1/ai/vaults/{vault}/conversations", headers=headers)
    assert listed.json()["data"] == []
    # And the messages went with it.
    gone = await client.get(f"/api/v1/ai/vaults/{vault}/conversations/{conversation_id}", headers=headers)
    assert gone.status_code == 404


async def test_history_belongs_to_its_vault_and_its_owner(
    client: AsyncClient, account: dict, stub_provider: list
) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    created = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "private"}, headers=headers)
    conversation_id = created.json()["data"]["conversation_id"]

    # Another vault of the SAME user must not answer for it: the assistant's
    # tools act on the vault in the path.
    other_vault = (
        await client.post("/api/v1/vaults", json={"name": f"Other {uuid.uuid4().hex[:6]}"}, headers=headers)
    ).json()["data"]["id"]
    assert (
        await client.get(f"/api/v1/ai/vaults/{other_vault}/conversations/{conversation_id}", headers=headers)
    ).status_code == 404
    assert (await client.get(f"/api/v1/ai/vaults/{other_vault}/conversations", headers=headers)).json()["data"] == []

    # And another user sees nothing at all.
    stranger = _auth(await _signup(client, "aiconv-other"))
    assert (await client.get(f"/api/v1/ai/vaults/{vault}/conversations", headers=stranger)).status_code == 404
    assert (
        await client.get(f"/api/v1/ai/vaults/{vault}/conversations/{conversation_id}", headers=stranger)
    ).status_code == 404


async def test_a_failed_turn_stores_nothing(client: AsyncClient, account: dict, monkeypatch) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]

    async def failing_turn(**kwargs: Any) -> ai_providers.Turn:
        raise ai_providers.ProviderError("nope")

    monkeypatch.setattr(ai_providers, "turn", failing_turn)
    resp = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "will fail"}, headers=headers)
    assert resp.status_code == 422
    # No half-written thread left behind.
    listed = await client.get(f"/api/v1/ai/vaults/{vault}/conversations", headers=headers)
    assert listed.json()["data"] == []


async def test_context_only_matters_for_the_prompt_not_the_transcript(
    client: AsyncClient, account: dict, stub_provider: list
) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    created = await client.post(
        f"/api/v1/ai/vaults/{vault}/chat",
        json={"message": "summarise this", "context": "# Open note\n\nbody text"},
        headers=headers,
    )
    conversation_id = created.json()["data"]["conversation_id"]
    full = await client.get(f"/api/v1/ai/vaults/{vault}/conversations/{conversation_id}", headers=headers)
    stored = full.json()["data"]["messages"]
    # The note excerpt rode along in the system prompt; storing it would make
    # the saved thread balloon and go stale.
    assert all("body text" not in m["content"] for m in stored)


async def test_long_conversations_are_capped_when_sent_to_the_provider(
    client: AsyncClient, account: dict, stub_provider: list
) -> None:
    headers = _auth(account["tokens"])
    vault = account["vault_id"]
    resp = await client.post(f"/api/v1/ai/vaults/{vault}/chat", json={"message": "start"}, headers=headers)
    conversation_id = resp.json()["data"]["conversation_id"]
    for i in range(int(ai_service.MAX_MESSAGES / 2) + 2):
        await client.post(
            f"/api/v1/ai/vaults/{vault}/chat",
            json={"message": f"turn {i}", "conversation_id": conversation_id},
            headers=headers,
        )
    assert len(stub_provider[-1]) <= ai_service.MAX_MESSAGES + 1
