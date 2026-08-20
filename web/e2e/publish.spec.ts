import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("publish", () => {
  test("share button publishes; public page renders without auth; unpublish kills it", async ({
    page,
    browser,
  }) => {
    await signupFreshUser(page, "publish-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    // Publish via the share popover
    await page.getByRole("button", { name: "Share note" }).click();
    await page.getByRole("button", { name: "Publish note" }).click();
    await expect(page.getByText("This note is public")).toBeVisible({ timeout: 10_000 });

    const url = (await page.locator("code").first().textContent()) ?? "";
    expect(url).toContain("/p/");

    // Open the public link in a FRESH context (no cookies, no auth)
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(url);
    await expect(anonPage.getByRole("heading", { name: "Welcome to Nodum" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(anonPage.getByText("linked knowledge base")).toBeVisible();

    // A shared link has to preview properly in a chat client, and unfurlers
    // read the raw HTML without running JavaScript — so the title and the
    // Open Graph card must be in the response, not added after hydration.
    const raw = await anonPage.request.get(url);
    const html = await raw.text();
    expect(html).toMatch(/<title>Welcome to Nodum[^<]*<\/title>/);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain("linked knowledge base");
    // ...but a token link is unlisted, not published to the world: robots.txt
    // excludes /p/ and the page carries its own noindex as the second lock.
    expect(html).toMatch(/<meta name="robots" content="noindex/);

    // Unpublish → the public page 404s
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Publish note")).toBeVisible({ timeout: 10_000 });

    await anonPage.reload();
    await expect(anonPage.getByText(/page not found/i)).toBeVisible({ timeout: 15_000 });
    await anonContext.close();
  });
});
