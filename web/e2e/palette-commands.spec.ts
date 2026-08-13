import { expect, test, type Page } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** Run a command through the ⌘P palette by its label. */
async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByPlaceholder("Select a command...").fill(label);
  await page.getByRole("option", { name: label }).first().click();
}

test.describe("command palette — command functionality", () => {
  test("Duplicate current file creates a copy tab", async ({ page }) => {
    await signupFreshUser(page, "dup-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    await runCommand(page, "Duplicate current file");

    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Welcome to Nodum copy",
      { timeout: 10_000 },
    );
    await expect(page.getByRole("tab", { name: /Welcome to Nodum copy/ })).toBeVisible();
  });

  test("Canvas: Create new canvas opens a canvas tab", async ({ page }) => {
    await signupFreshUser(page, "canvas-cmd-e2e");

    await runCommand(page, "Canvas: Create new canvas");

    await expect(page.getByRole("tab", { name: /Untitled canvas/ })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Outline: Show outline switches the right panel", async ({ page }) => {
    await signupFreshUser(page, "outline-cmd-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    await runCommand(page, "Outline: Show outline of the current file");

    await expect(page.getByRole("button", { name: "Outline", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 10_000 },
    );
  });

  test("Zoom in increases the editor font size", async ({ page }) => {
    await signupFreshUser(page, "zoom-cmd-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    const cm = page.locator(".cm-content").first();
    await expect(cm).toBeVisible({ timeout: 10_000 });
    const before = await cm.evaluate((el) => getComputedStyle(el).fontSize);

    await runCommand(page, "Zoom in");

    await expect
      .poll(() => cm.evaluate((el) => getComputedStyle(el).fontSize), { timeout: 10_000 })
      .not.toBe(before);
  });

  test("Toggle ribbon hides the left ribbon", async ({ page }) => {
    await signupFreshUser(page, "ribbon-cmd-e2e");
    const paletteBtn = page.getByRole("button", { name: "Command palette (⌘P)" });
    await expect(paletteBtn).toBeVisible({ timeout: 10_000 });

    await runCommand(page, "Toggle ribbon");

    await expect(paletteBtn).toBeHidden({ timeout: 10_000 });
  });
});
