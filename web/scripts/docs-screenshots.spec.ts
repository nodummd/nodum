import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "../e2e/helpers";

/**
 * Screenshots for /docs, taken from the real interface on a fresh account
 * with the Demo Workspace — so they show what a person actually sees, and can
 * be re-captured whenever the interface changes. Every image lands in
 * public/docs/<name>.png at 1x, clipped to the part of the screen the article
 * is about.
 */

const OUT = path.join(__dirname, "..", "public", "docs");

/** Open a note via the quick switcher — reliable regardless of where the
 *  explorer (a virtualized list) is scrolled. */
async function openViaSwitcher(page: Page, title: string) {
  await page.keyboard.press("ControlOrMeta+o");
  await page.getByPlaceholder("Find or create a note…").fill(title);
  await page.waitForTimeout(400);
  await page.getByPlaceholder("Find or create a note…").press("Enter");
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title, { timeout: 10_000 });
}

async function shot(page: Page, name: string, target?: Locator, pad = 8, maxHeight?: number) {
  const file = path.join(OUT, `${name}.png`);
  if (!target) {
    await page.screenshot({ path: file, fullPage: false });
    return;
  }
  const box = await target.boundingBox();
  if (!box) throw new Error(`no box for ${name}`);
  const vw = page.viewportSize()!;
  const height = Math.min(vw.height - Math.max(0, box.y - pad), box.height + pad * 2, maxHeight ?? Infinity);
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(vw.width - Math.max(0, box.x - pad), box.width + pad * 2),
      height,
    },
  });
}

/** Clip to a rectangle spanning several elements. */
async function shotUnion(page: Page, name: string, targets: Locator[], pad = 8) {
  const boxes = (await Promise.all(targets.map((t) => t.boundingBox()))).filter(Boolean) as {
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  const x = Math.min(...boxes.map((b) => b.x)) - pad;
  const y = Math.min(...boxes.map((b) => b.y)) - pad;
  const r = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const b = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: { x: Math.max(0, x), y: Math.max(0, y), width: r - Math.max(0, x), height: b - Math.max(0, y) },
  });
}

async function api<T = unknown>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const token = (await (await fetch("/api/v1/auth/refresh", { method: "POST" })).json()).data
        .access_token;
      const r = await fetch(`/api/v1${url}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text).data : null;
    },
    { method, url, body },
  );
}

/** A stand-in AI provider on loopback: answers with a note-creating tool call,
 *  then a sentence — enough for one honest picture of the panel at work. */
let stub: Server;
let stubUrl: string;
test.beforeAll(async () => {
  let n = 0;
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      n += 1;
      const reply =
        n === 1
          ? {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: {
                          name: "create_note",
                          arguments: JSON.stringify({
                            title: "Reading plan for autumn",
                            content:
                              "Three books, one a month, notes as I go.\n\n- [[Antifragile]]\n- [[Sapiens]]\n- [[Clean Code]]\n\nSee [[Books MOC]] for the shelf.",
                            folder: "Projects",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content:
                      "Done — I created **Reading plan for autumn** in Projects and linked it to the three books and to [[Books MOC]]. Want me to add a first daily entry as well?",
                  },
                },
              ],
            };
      const parsed = raw ? (JSON.parse(raw) as { stream?: boolean }) : null;
      if (parsed?.stream) {
        // The panel streams now: answer as SSE — text, tool-call fragments,
        // a finish_reason, then [DONE] (the shape a real OpenAI endpoint sends).
        const message = reply.choices[0].message as {
          content: string | null;
          tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
        };
        const chunks: string[] = [];
        const text = message.content ?? "";
        const step = Math.max(1, Math.ceil(text.length / 4));
        for (let i = 0; i < text.length; i += step) {
          chunks.push(JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + step) } }] }));
        }
        (message.tool_calls ?? []).forEach((call, index) => {
          chunks.push(
            JSON.stringify({
              choices: [
                { delta: { tool_calls: [{ index, id: call.id, type: "function", function: call.function }] } },
              ],
            }),
          );
        });
        chunks.push(
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: message.tool_calls?.length ? "tool_calls" : "stop" }],
          }),
        );
        chunks.push("[DONE]");
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of chunks) res.write(`data: ${chunk}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});

test("capture the documentation screenshots", async ({ page }) => {
  await signupFreshUser(page, "docs-shots", { keepFirstRun: true });

  // ── The tour, on the explorer step ─────────────────────────────────────
  const tour = page.getByTestId("tour");
  const card = page.getByTestId("tour-card");
  await expect(tour).toBeVisible();
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card).toHaveAttribute("data-step", "explorer");
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUT, "tour.png"),
    clip: { x: 0, y: 0, width: 760, height: 330 },
  });
  // Skip to the demo question and take it up.
  await card.getByRole("button", { name: "Skip" }).click();
  await expect(card).toHaveAttribute("data-step", "demo");
  await shot(page, "demo-offer", card, 24);
  await card.getByRole("button", { name: "Create demo workspace" }).click();
  await expect(page.getByRole("button", { name: /Switch vault/ })).toContainText("Demo Workspace", {
    timeout: 60_000,
  });
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Home", {
    timeout: 20_000,
  });
  const vaultId = page.url().split("/vault/")[1].split(/[?#]/)[0];

  // ── The workspace as a whole ───────────────────────────────────────────
  await page.getByRole("button", { name: /Collapse all|Expand all/ }).click();
  // Let the "demo is ready" toast go before the picture.
  await expect(page.getByText(/is ready —/)).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, "workspace");

  const explorer = page.locator('[data-tour="explorer"]');
  const main = page.locator('[data-tour="editor"]');
  const panels = page.locator('[data-tour="panels"]');

  // ── Explorer with a folder's context menu ──────────────────────────────
  await page.getByRole("button", { name: /^Books$/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.waitForTimeout(350); // let the menu's fade-in finish
  await shotUnion(page, "explorer", [explorer, page.getByRole("menu")]);
  await page.keyboard.press("Escape");

  // ── Editor: live preview of a linked note ──────────────────────────────
  await page.getByRole("button", { name: /^Areas$/ }).first().click();
  await page.getByRole("button", { name: /^Health$/ }).first().click();
  await openNoteFromExplorer(page, "Health MOC");
  await page.waitForTimeout(400);
  await shot(page, "editor-live", main);

  // Right-click menu on a selection.
  const firstLine = page.locator(".cm-line").first();
  await firstLine.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight");
  await firstLine.click({ button: "right", position: { x: 4, y: 8 } });
  await expect(page.getByRole("menu").first()).toBeVisible();
  await page.waitForTimeout(350);
  await shotUnion(page, "editor-menu", [main, page.getByRole("menu").first()]);
  await page.keyboard.press("Escape");

  // The [[ completion list.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Related: [[Slee");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 8_000 });
  await shot(page, "wikilink-autocomplete", main);
  await page.keyboard.press("Escape");
  // Leave the note as it was.
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  // ── Backlinks panel ────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Backlinks", exact: true }).click();
  await expect(panels.getByText(/Linked mentions/)).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "backlinks", panels, 8, 560);

  // ── Tags panel ─────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.waitForTimeout(400);
  await shot(page, "tags", panels, 8, 560);

  // ── Graph ──────────────────────────────────────────────────────────────
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(9_000); // let the layout settle and the camera fit
  await shot(page, "graph", main);
  await page.getByRole("button", { name: "Graph settings", exact: true }).click();
  await page.waitForTimeout(400);
  await shotUnion(page, "graph-settings", [main]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Close Graph view/ }).click();

  // ── Search ─────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Search", exact: true }).first().click();
  await page.getByPlaceholder(/search/i).first().fill("habit");
  await page.waitForTimeout(1_200);
  await shot(page, "search", explorer, 8, 620);
  await page.getByRole("button", { name: "Files", exact: true }).click();

  // ── Quick switcher and palette ─────────────────────────────────────────
  await page.keyboard.press("ControlOrMeta+o");
  await page.getByPlaceholder("Find or create a note…").fill("med");
  await page.waitForTimeout(900);
  await shot(page, "switcher", page.getByRole("dialog"), 16);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByPlaceholder(/command/i).fill("split");
  await page.waitForTimeout(500);
  await shot(page, "palette", page.getByRole("dialog"), 16);
  await page.keyboard.press("Escape");

  // ── Tabs and split panes ───────────────────────────────────────────────
  await page.getByRole("button", { name: /^Sleep$/ }).first().click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("ControlOrMeta+\\");
  await page.waitForTimeout(600);
  await shot(page, "tabs", main);
  await page.getByRole("button", { name: /Close Sleep/ }).first().click();
  await page.getByRole("button", { name: /Close Sleep/ }).first().click().catch(() => undefined);
  await page.getByRole("button", { name: /Close Health MOC/ }).last().click().catch(() => undefined);

  // ── Templates picker ───────────────────────────────────────────────────
  await openViaSwitcher(page, "Home");
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByPlaceholder(/command/i).fill("insert template");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "templates", page.getByRole("dialog"), 16);
  await page.keyboard.press("Escape");

  // ── Bookmarks ──────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Bookmark this note" }).click();
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, "bookmarks", explorer, 8, 320);
  await page.getByRole("button", { name: "Files", exact: true }).click();

  // ── Canvas ─────────────────────────────────────────────────────────────
  const canvas = await api<{ id: string }>(page, "POST", `/vaults/${vaultId}/canvases`, {
    name: "Reading plan",
  });
  await api(page, "PUT", `/vaults/${vaultId}/canvases/${canvas.id}/data`, {
    data: {
      nodes: [
        { id: "a", type: "text", x: 40, y: 80, width: 240, height: 110, text: "Why keep a reading log?\n\nTo notice what changed my mind." },
        { id: "b", type: "text", x: 380, y: 40, width: 220, height: 90, text: "[[Antifragile]]" },
        { id: "c", type: "text", x: 380, y: 200, width: 220, height: 90, text: "[[Sapiens]]" },
        { id: "d", type: "text", x: 700, y: 120, width: 240, height: 100, text: "One page of notes per book, linked from [[Books MOC]]" },
      ],
      edges: [
        { id: "e1", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" },
        { id: "e2", fromNode: "a", toNode: "c", fromSide: "right", toSide: "left" },
        { id: "e3", fromNode: "b", toNode: "d", fromSide: "right", toSide: "left", label: "notes" },
        { id: "e4", fromNode: "c", toNode: "d", fromSide: "right", toSide: "left" },
      ],
    },
  });
  await page.reload();
  await page.getByRole("button", { name: /Reading plan/ }).first().click();
  await page.waitForTimeout(1_200);
  await shot(page, "canvas", main);
  await page.getByRole("button", { name: /Close Reading plan/ }).click().catch(() => undefined);

  // ── Vault switcher ─────────────────────────────────────────────────────
  await page.getByRole("button", { name: /Switch vault/ }).click();
  await page.waitForTimeout(300);
  await shotUnion(page, "vault-switcher", [explorer.locator("xpath=./div[1]"), page.getByRole("menu")]);
  await page.keyboard.press("Escape");

  // ── Share dialog ───────────────────────────────────────────────────────
  await openViaSwitcher(page, "Home");
  await page.getByRole("button", { name: /Share/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "share", page.getByRole("dialog"), 16);
  await page.keyboard.press("Escape");

  // ── AI: a real exchange against the stub ───────────────────────────────
  await api(page, "PUT", "/ai/credentials", {
    provider: "openai", // the stub speaks the OpenAI shape
    api_key: "fake-docs-screenshot-key",
    model: "gpt-4.1",
    base_url: stubUrl,
  });
  await page.reload();
  await page.getByRole("button", { name: "AI chat" }).click();
  await page.getByLabel("Message the assistant").fill("Make me a note planning three books to read this autumn, linked to the ones already in the vault.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: /Created Reading plan/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await shot(page, "ai-chat", panels, 8, 460);

  // ── Settings tabs ──────────────────────────────────────────────────────
  await page.keyboard.press("ControlOrMeta+,");
  const settings = page.getByRole("dialog");
  await expect(settings).toBeVisible();
  const tabs: [string, string][] = [
    ["General", "settings-general"],
    ["Vault", "settings-vault"],
    ["AI", "settings-ai"],
    ["Plugins", "settings-plugins"],
    ["Web Clipper", "settings-clipper"],
    ["Collab", "settings-collab"],
  ];
  for (const [tab, name] of tabs) {
    await settings.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(500);
    await shot(page, name, settings, 12);
  }
  // MCP, with a freshly minted token so the configs are filled in.
  await settings.getByRole("button", { name: "MCP", exact: true }).click();
  await settings.getByPlaceholder("Claude Desktop on my laptop").fill("Claude Desktop on my laptop");
  await settings.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByTestId("mcp-fresh-token")).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "settings-mcp", settings, 12);
  // The picture shows a token; revoke it so what is in the image is dead.
  await settings.getByRole("button", { name: "Revoke token Claude Desktop on my laptop" }).click();
  await expect(settings.getByRole("button", { name: "Revoke token Claude Desktop on my laptop" })).toHaveCount(0);

  // API keys: the create dialog in its shown-once phase — key + curl visible.
  await settings.getByRole("button", { name: "API keys", exact: true }).click();
  await settings.getByRole("button", { name: "Create key" }).click();
  const keyDialog = page.getByRole("dialog", { name: "Create an API key" });
  await keyDialog.getByPlaceholder("My sync script").fill("My sync script");
  await keyDialog.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("api-fresh-key")).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "settings-api-keys", page.getByRole("dialog", { name: "Copy your key now" }), 12);
  await page.getByRole("dialog", { name: "Copy your key now" }).getByRole("button", { name: "Done" }).click();
  // The picture shows a key; revoke it so what is in the image is dead.
  await settings.getByRole("button", { name: "Revoke key My sync script" }).click();
  await expect(settings.getByRole("button", { name: "Revoke key My sync script" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The interactive API reference — a public page, so no session is involved.
  await page.goto("/api-reference");
  await expect(page.getByRole("heading", { name: "Nodum API" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot(page, "api-reference");

  // The forum and the community hub — both public.
  await page.goto("/forum");
  await expect(page.getByRole("heading", { name: "Talk Nodum" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, "forum");
  await page.goto("/community");
  await expect(page.getByRole("heading", { name: "Built in the open" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, "community");
});
