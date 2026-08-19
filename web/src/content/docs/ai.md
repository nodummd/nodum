---
title: AI chat
section: Extending
order: 3
summary: Chat with your own AI provider about your vault — it can search, read, create and extend notes. Your key, your account, your cost.
where: Right sidebar → the sparkles icon; Settings → AI to set it up
---

## Your key

Nodum has no AI of its own. Settings → AI: pick a provider (Claude, OpenAI, Gemini or Qwen), paste an API key from your account with them, choose a model. The key is encrypted before it is stored, is never sent back to your browser, and is used only for requests you make. Usage is billed by the provider to you.

![Settings → AI.](/docs/settings-ai.png)

## Chatting

Open the sparkles panel in the right sidebar and ask. The note you are reading travels along as context, so *summarise this* works. The assistant can **search** the vault, **read** notes, **create** a note and **append** to one — and every note it writes shows up as a card in the chat that opens it. It cannot rename, overwrite or delete anything.

![The AI panel, after asking for a note to be written.](/docs/ai-chat.png)

Chats are saved per vault: the clock icon lists them, `+` starts a new one, and a reload brings back the one you were in.

## Not set up yet

Opening the panel without a key explains what is missing and takes you to Settings → AI.
