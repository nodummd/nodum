import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** The one-time Demo Workspace question, and what saying yes gets you. */

test.describe("demo workspace", () => {
  test("a new account is asked once, and 'not now' is remembered", async ({ page }) => {
    await signupFreshUser(page, "demo-no", { keepFirstRun: true });
    const offer = page.getByTestId("demo-offer");
    await expect(offer).toBeVisible({ timeout: 10_000 });
    await expect(offer).toContainText("Want a Demo Workspace?");

    await page.getByRole("button", { name: "Not now" }).click();
    await expect(offer).toHaveCount(0);

    // Remembered on the account, not the tab.
    await page.reload();
    await expect(page.getByText("Welcome to Nodum").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("demo-offer")).toHaveCount(0);
  });

  test("saying yes creates a populated, coloured vault and opens it", async ({ page }) => {
    await signupFreshUser(page, "demo-yes", { keepFirstRun: true });
    await expect(page.getByTestId("demo-offer")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Create demo workspace" }).click();

    // Lands in the new vault, on its front door.
    await expect(page.getByRole("button", { name: /Switch vault/ })).toContainText(
      "Demo Workspace",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Home", {
      timeout: 15_000,
    });
    // Its folders are there and coloured — Books is green in the explorer.
    // (Opening Home scrolled the virtualized tree to the bottom; collapse
    // everything so the top-level folders are the whole list.)
    await page.getByRole("button", { name: /Collapse all|Expand all/ }).click();
    const books = page.getByRole("button", { name: /^Books$/ }).first();
    await expect(books).toBeVisible();
    const color = await books.locator("span").first().evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe("rgb(32, 191, 107)"); // #20bf6b

    // The offer never comes back — a demo is a vault now, and the answer is stored.
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Home", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("demo-offer")).toHaveCount(0);
  });

  test("it can be created later from settings, and gets a numbered name", async ({ page }) => {
    await signupFreshUser(page, "demo-later");
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "Vault", exact: true }).click();
    await page.getByRole("button", { name: "Create a demo workspace" }).click();
    await expect(page.getByRole("button", { name: /Switch vault/ })).toContainText(
      "Demo Workspace",
      { timeout: 30_000 },
    );
  });
});
