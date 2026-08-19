import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** Nodum as an MCP server: mint a token in settings, then speak the protocol
 *  through the same origin the browser uses — the URL the screen shows. */

const RPC = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

test.describe("MCP", () => {
  test("a token minted in settings drives the vault over MCP; revoking cuts it off", async ({ page, request }) => {
    await signupFreshUser(page, "mcp");
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "MCP", exact: true }).click();

    // The endpoint is this origin — the same one the browser talks to.
    const endpoint = await page.locator("code").filter({ hasText: "/api/v1/mcp" }).first().innerText();
    expect(endpoint).toBe(`${new URL(page.url()).origin}/api/v1/mcp`);

    await page.getByPlaceholder("Claude Desktop on my laptop").fill("e2e client");
    await page.getByRole("button", { name: "Create token" }).click();
    const fresh = page.getByTestId("mcp-fresh-token");
    await expect(fresh).toBeVisible();
    const token = (await fresh.locator("code").innerText()).trim();
    expect(token).toMatch(/^nodum_mcp_[A-Za-z0-9_-]{40,}$/);
    // The snippets picked it up.
    await expect(page.locator("pre").first()).toContainText(token);
    // The list shows a hint, never the token.
    await expect(page.getByText(`…${token.slice(-4)}`)).toBeVisible();

    const headers = { ...RPC, Authorization: `Bearer ${token}` };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
      const res = await request.post(endpoint, {
        headers,
        data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      });
      expect(res.status(), name).toBe(200);
      // Streamable HTTP answers each POST as a short SSE stream: the response
      // is the last `data:` frame (progress notifications may come before it).
      const frames = (await res.text())
        .replace(/\r\n/g, "\n")
        .split("\n\n")
        .map((block) =>
          block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n"),
        )
        .filter(Boolean)
        .map(
          (data) =>
            JSON.parse(data) as {
              id?: number;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              result?: { isError?: boolean; content?: unknown; structuredContent?: any };
            },
        );
      const body = frames.filter((f) => f.id === 1).at(-1)!;
      expect(body.result!.isError, JSON.stringify(body.result!.content)).toBeFalsy();
      const sc = body.result!.structuredContent;
      return sc?.result ?? sc;
    };

    // Real work, from outside the app: a vault, a folder, two linked notes, a colour.
    const vault = await call("create_vault", { name: "From MCP" });
    await call("create_note", { vault_id: vault.id, title: "Alpha", content: "Leads to [[Beta]].", folder: "Ideas" });
    await call("create_note", { vault_id: vault.id, title: "Beta", content: "Came from [[Alpha]].", folder: "Ideas" });
    await call("set_item_color", { vault_id: vault.id, path: "Ideas", color: "#20bf6b" });
    const graph = await call("get_graph", { vault_id: vault.id });
    expect(graph.edges.length).toBe(2);

    // …and it is really there when the app looks.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Switch vault/ }).click();
    const opened = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "From MCP" }).click();
    const other = await opened;
    await expect(other.getByRole("button", { name: /Switch vault/ })).toContainText("From MCP", { timeout: 20_000 });
    const ideas = other.getByRole("button", { name: /^Ideas$/ }).first();
    await expect(ideas).toBeVisible();
    expect(await ideas.locator("span").first().evaluate((el) => getComputedStyle(el).color)).toBe("rgb(32, 191, 107)");
    await other.close();

    // Revoke → the next call is refused.
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    await page.getByRole("button", { name: "Revoke token e2e client" }).click();
    await expect(page.getByRole("button", { name: "Revoke token e2e client" })).toHaveCount(0);
    const refused = await request.post(endpoint, {
      headers,
      data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(refused.status()).toBe(401);
  });

  test("the MCP article is in the docs", async ({ page }) => {
    await page.goto("/docs/mcp");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("MCP");
    await expect(page.locator(".mk-docs-figure img")).toHaveCount(1);
  });
});
