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

    // Unpublish → the public page 404s
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Publish note")).toBeVisible({ timeout: 10_000 });

    await anonPage.reload();
    await expect(anonPage.getByText(/page not found/i)).toBeVisible({ timeout: 15_000 });
    await anonContext.close();
  });
});
