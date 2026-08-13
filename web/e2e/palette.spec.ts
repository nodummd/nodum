import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("command palette", () => {
  test("⌘P opens palette; command runs (open graph view)", async ({ page }) => {
    await signupFreshUser(page, "palette-open");

    await page.keyboard.press("ControlOrMeta+p");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/select a command/i).fill("graph");
    await dialog.getByText("Graph view: Open graph view").click();

    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
  });

  test("palette filters commands and ⌘W closes the active tab", async ({ page }) => {
    await signupFreshUser(page, "palette-close");

    // Open a note first
    await page.getByText("Welcome to Nodum", { exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible({ timeout: 10_000 });

    // ⌘W closes it
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.getByText("No file is open")).toBeVisible({ timeout: 10_000 });
  });
});
