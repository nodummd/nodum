import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("mobile workspace", () => {
  test("drawers open/close, note editable, no horizontal scroll", async ({ page }) => {
    await signupFreshUser(page, "mobile");

    // Top bar visible with hamburger; desktop ribbon hidden
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

    // Left drawer: open → pick a note → drawer auto-closes
    await page.getByRole("button", { name: "Open navigation" }).click();
    const navDrawer = page.getByRole("dialog", { name: "Navigation drawer" });
    await expect(navDrawer).toBeVisible();
    await navDrawer.getByText("Welcome to Nodum", { exact: true }).click();
    await expect(navDrawer).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Welcome to Nodum",
      { timeout: 10_000 },
    );

    // Note is editable on touch layout
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("ControlOrMeta+ArrowDown");
    await page.keyboard.type(" Mobile edit.");
    await expect(page.locator(".cm-content").first()).toContainText("Mobile edit.");

    // Right drawer: panels
    await page.getByRole("button", { name: "Open panels" }).click();
    const panelsDrawer = page.getByRole("dialog", { name: "Panels drawer" });
    await expect(panelsDrawer).toBeVisible();
    await expect(panelsDrawer.getByText(/Linked mentions/)).toBeVisible({ timeout: 10_000 });
    // Backdrop click closes
    await page.mouse.click(30, 700);
    await expect(panelsDrawer).not.toBeVisible({ timeout: 5_000 });

    // No horizontal scroll anywhere
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fits).toBe(true);
  });
});
