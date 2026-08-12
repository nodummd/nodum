import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("pinned tabs + navigation history", () => {
  test("pinning hides close and blocks ⌘W; ⌘[/⌘] walk note history", async ({ page }) => {
    await signupFreshUser(page, "pinhist");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    // Pin via tab context menu
    await page.getByRole("tab", { name: /Welcome to Nodum/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin" }).click();
    await expect(page.getByRole("button", { name: "Close Welcome to Nodum" })).toHaveCount(0);

    // ⌘W must not close a pinned tab
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.getByRole("tab", { name: /Welcome to Nodum/ })).toBeVisible();

    // Build history: Welcome → Formatting showcase → Linking your thinking
    await openNoteFromExplorer(page, "Formatting showcase");
    await openNoteFromExplorer(page, "Linking your thinking");

    const title = page.getByRole("textbox", { name: "Note title" });
    await page.keyboard.press("ControlOrMeta+[");
    await expect(title).toHaveValue("Formatting showcase", { timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+[");
    await expect(title).toHaveValue("Welcome to Nodum", { timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+]");
    await expect(title).toHaveValue("Formatting showcase", { timeout: 10_000 });

    // Unpin restores the close button
    await page.getByRole("tab", { name: /Welcome to Nodum/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Unpin" }).click();
    await page.getByRole("tab", { name: /Welcome to Nodum/ }).hover();
    await expect(page.getByRole("button", { name: "Close Welcome to Nodum" })).toBeVisible();
  });
});
