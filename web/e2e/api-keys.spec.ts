import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** The public API: mint a scoped key in settings, then drive the vault over
 *  plain REST through the same origin the browser uses — exactly as an
 *  external program would. */

test.describe("API keys", () => {
  test("a key minted in settings drives the vault over REST; scopes and revocation hold", async ({
    page,
    request,
  }) => {
    await signupFreshUser(page, "apikeys");
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "API keys", exact: true }).click();

    // The base URL is this origin — the same one the browser talks to.
    const baseUrl = await page.locator("code").filter({ hasText: "/api/public/v1" }).first().innerText();
    expect(baseUrl).toBe(`${new URL(page.url()).origin}/api/public/v1`);

    // A read+write key (drop the pre-ticked scopes we don't want — none).
    await page.getByPlaceholder("My sync script").fill("e2e script");
    await page.getByRole("button", { name: "Create key" }).click();
    const fresh = page.getByTestId("api-fresh-key");
    await expect(fresh).toBeVisible();
    const key = (await fresh.locator("code").innerText()).trim();
    expect(key).toMatch(/^nodum_key_[A-Za-z0-9_-]{40,}$/);
    // The try-it curl picked it up, and the list shows a hint, never the key.
    await expect(page.getByTestId("api-curl")).toContainText(key);
    await expect(page.getByText(`…${key.slice(-4)}`)).toBeVisible();
    await expect(page.getByText("read · write")).toBeVisible();

    const headers = { Authorization: `Bearer ${key}` };

    // Real work, from outside the app: list vaults, write, link, search.
    const vaults = (await (await request.get(`${baseUrl}/vaults`, { headers })).json()).data;
    expect(vaults.length).toBeGreaterThan(0);
    const vaultId = vaults[0].id;

    const alpha = (
      await (
        await request.post(`${baseUrl}/vaults/${vaultId}/notes`, {
          headers,
          data: { title: "From the API", folder: "Inbox", content: "Quetzalcoatlus flies." },
        })
      ).json()
    ).data;
    expect(alpha.path).toBe("Inbox/From the API");

    const beta = (
      await (
        await request.post(`${baseUrl}/vaults/${vaultId}/notes`, { headers, data: { title: "API target" } })
      ).json()
    ).data;
    const linked = await request.post(`${baseUrl}/vaults/${vaultId}/notes/${alpha.id}/links`, {
      headers,
      data: { target: "API target" },
    });
    expect(linked.status()).toBe(201);
    const backlinks = (
      await (await request.get(`${baseUrl}/vaults/${vaultId}/notes/${beta.id}/backlinks`, { headers })).json()
    ).data;
    expect(backlinks.backlinks.map((b: { title: string }) => b.title)).toEqual(["From the API"]);

    const hits = (
      await (await request.get(`${baseUrl}/vaults/${vaultId}/search?q=Quetzalcoatlus`, { headers })).json()
    ).data;
    expect(hits.total).toBe(1);

    // No delete scope on this key → 403 naming the missing scope.
    const denied = await request.delete(`${baseUrl}/vaults/${vaultId}/notes/${alpha.id}`, { headers });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.message).toContain("'delete'");

    // …and the note is visible in the app, where the person is. External
    // writes reach the browser on its next fetch, so reload to refetch.
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: /^Inbox$/ }).first()).toBeVisible({ timeout: 15_000 });

    // Revoke → the next call is refused.
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "API keys", exact: true }).click();
    await page.getByRole("button", { name: "Revoke key e2e script" }).click();
    await expect(page.getByRole("button", { name: "Revoke key e2e script" })).toHaveCount(0);
    const refused = await request.get(`${baseUrl}/vaults`, { headers });
    expect(refused.status()).toBe(401);
  });

  test("the API article is in the docs and the interactive reference renders", async ({ page }) => {
    await page.goto("/docs/api");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("API");
    await expect(page.locator(".mk-docs-figure img")).toHaveCount(2);

    await page.goto("/api-reference");
    await expect(page.getByRole("heading", { name: "Nodum API" })).toBeVisible({ timeout: 20_000 });
    // A real operation from the spec, rendered by Scalar — and the try-it
    // client offers the ApiKey bearer scheme.
    await expect(page.getByText("List vaults").first()).toBeVisible();
    await expect(page.getByText("ApiKey").first()).toBeVisible();
  });
});
