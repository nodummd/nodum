import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { expect, test, type Page } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** The AI chat panel: the unconfigured gate, an ordinary answer, and a turn
 *  where the assistant writes a note into the vault.
 *
 *  The provider is a stub HTTP server run by this test. The backend calls it
 *  server-to-server (the key never touches the browser), so `page.route` cannot
 *  intercept it — a real socket is the only honest way to drive the tool loop.
 *  Pointing at it uses the same `base_url` field a self-hosted endpoint would. */

/** Queue of OpenAI-shaped responses; each request shifts one off. */
let stubReplies: unknown[] = [];
let stubRequests: unknown[] = [];
let stub: Server;
let stubUrl: string;

function chatMessage(content: string) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

test.beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      stubRequests.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const reply = stubReplies.shift() ?? chatMessage("(stub ran out of replies)");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

test.beforeEach(() => {
  stubReplies = [];
  stubRequests = [];
});

/** Store a key pointed at the stub, through the real API. */
async function configureStubProvider(page: Page, baseUrl: string) {
  await page.evaluate(async (url) => {
    const token = (await (await fetch("/api/v1/auth/refresh", { method: "POST" })).json()).data
      .access_token;
    await fetch("/api/v1/ai/credentials", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        provider: "openai",
        api_key: "sk-stub-e2e-key",
        model: "stub-model",
        base_url: url,
      }),
    });
  }, baseUrl);
}

const openAiPanel = (page: Page) => page.getByRole("button", { name: "AI chat" }).click();

test.describe("AI chat panel", () => {
  test("without a key it explains and offers to set it up", async ({ page }) => {
    await signupFreshUser(page, "ai-gate");
    await openAiPanel(page);

    await expect(page.getByText("AI is not set up yet")).toBeVisible();
    await page.getByRole("button", { name: "Set up AI" }).click();
    // It lands on the tab that fixes it, not just "settings".
    await expect(page.getByText("AI PROVIDER")).toBeVisible();
  });

  test("a question is answered through the configured provider", async ({ page }) => {
    await signupFreshUser(page, "ai-chat");
    await configureStubProvider(page, stubUrl);
    await page.reload();
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openAiPanel(page);

    stubReplies = [chatMessage("Your vault has **three** notes.")];
    await page.getByLabel("Message the assistant").fill("How many notes do I have?");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Your vault has three notes.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/openai · stub-model/)).toBeVisible();

    // The open note travelled as context, and the key went to the provider —
    // never to the browser.
    const sent = stubRequests[0] as {
      headers: Record<string, string>;
      body: { messages: { role: string; content: string }[] };
    };
    expect(sent.headers.authorization).toBe("Bearer sk-stub-e2e-key");
    expect(sent.body.messages[0].content).toContain("Welcome to Nodum");
  });

  test("the assistant can create a note, and the change is shown and openable", async ({ page }) => {
    await signupFreshUser(page, "ai-write");
    await configureStubProvider(page, stubUrl);
    await page.reload();
    await openAiPanel(page);

    stubReplies = [
      toolCall("create_note", {
        title: "Spaced repetition",
        content: "Review at increasing intervals. See [[Welcome to Nodum]].",
      }),
      chatMessage("Done — I created **Spaced repetition** and linked it."),
    ];
    await page.getByLabel("Message the assistant").fill("Write me a note about spaced repetition");
    await page.getByRole("button", { name: "Send" }).click();

    // The write is surfaced as a card, never silently.
    const card = page.getByRole("button", { name: /Created Spaced repetition/ });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // It really exists in the vault, and the card opens it.
    await expect(page.getByText("Spaced repetition", { exact: true }).first()).toBeVisible();
    await card.click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Spaced repetition",
      { timeout: 10_000 },
    );

    // The tool result went back to the provider before it answered.
    const second = stubRequests[1] as { body: { messages: { role: string }[] } };
    expect(second.body.messages.some((m) => m.role === "tool")).toBe(true);
  });

  test("the transcript survives a reload, and old chats can be reopened", async ({ page }) => {
    await signupFreshUser(page, "ai-history");
    await configureStubProvider(page, stubUrl);
    await page.reload();
    await openAiPanel(page);

    stubReplies = [chatMessage("First answer.")];
    await page.getByLabel("Message the assistant").fill("First question");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("First answer.")).toBeVisible({ timeout: 15_000 });

    // The whole point: a reload does not lose the conversation.
    await page.reload();
    await openAiPanel(page);
    await expect(page.getByText("First question")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("First answer.")).toBeVisible();

    // A second thread is separate, and the first is still reachable.
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByText("First question")).toHaveCount(0);
    stubReplies = [chatMessage("Second answer.")];
    await page.getByLabel("Message the assistant").fill("Second question");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Second answer.")).toBeVisible({ timeout: 15_000 });

    // Continuing a thread sends its history — the server rebuilds it, so the
    // provider sees the earlier turns even though the client posted one line.
    const lastCall = stubRequests.at(-1) as { body: { messages: { content: string }[] } };
    expect(lastCall.body.messages.map((m) => m.content)).toContain("Second question");
    expect(lastCall.body.messages.map((m) => m.content)).not.toContain("First question");

    await page.getByRole("button", { name: "Chat history" }).click();
    await page.getByRole("menuitem", { name: "First question" }).click();
    await expect(page.getByText("First answer.")).toBeVisible({ timeout: 10_000 });
  });

  test("a chat can be deleted from the history menu", async ({ page }) => {
    await signupFreshUser(page, "ai-delete");
    await configureStubProvider(page, stubUrl);
    await page.reload();
    await openAiPanel(page);

    stubReplies = [chatMessage("Answer.")];
    await page.getByLabel("Message the assistant").fill("Disposable question");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Answer.")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Chat history" }).click();
    await page.getByRole("button", { name: "Delete chat Disposable question" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Disposable question")).toHaveCount(0, { timeout: 10_000 });

    await page.reload();
    await openAiPanel(page);
    await expect(page.getByText("Disposable question")).toHaveCount(0);
  });

  test("a provider failure is reported and the question is not lost", async ({ page }) => {
    await signupFreshUser(page, "ai-fail");
    // A base_url nothing is listening on: the request cannot succeed.
    await configureStubProvider(page, "http://127.0.0.1:9");
    await page.reload();
    await openAiPanel(page);

    await page.getByLabel("Message the assistant").fill("anything");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/AI request failed|Could not reach the provider/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Message the assistant")).toHaveValue("anything");
  });
});
