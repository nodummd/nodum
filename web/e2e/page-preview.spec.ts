import { expect, test } from "@playwright/test";

import { createNoteViaApi, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("page preview popover", () => {
  test("Cmd+hover over a wikilink shows a reading-view excerpt", async ({ page }) => {
    await signupFreshUser(page, "preview-e2e");

    await createNoteViaApi(page, "Preview target", "A very peekable body of text.");
    await createNoteViaApi(page, "Preview source", "Jump to [[Preview target]] now.");
    await page.reload();
    await openNoteFromExplorer(page, "Preview source");

    const link = page.locator('[data-wikilink-target="Preview target"]').first();
    await expect(link).toBeVisible({ timeout: 10_000 });

    await page.keyboard.down("ControlOrMeta");
    await link.hover();
    await expect(page.locator(".nodum-page-preview")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".nodum-page-preview")).toContainText("A very peekable body", {
      timeout: 10_000,
    });
    await page.keyboard.up("ControlOrMeta");

    // Moving off the link dismisses the popover
    await page.getByRole("textbox", { name: "Note title" }).hover();
    await expect(page.locator(".nodum-page-preview")).not.toBeVisible({ timeout: 5_000 });
  });
});
