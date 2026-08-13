import { expect, test } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("version history", () => {
  test("palette opens the dialog; restore round-trips content", async ({ page }) => {
    await signupFreshUser(page, "versions-e2e");

    await createNoteViaApi(page, "Versioned note", "Original text here.");
    await page.reload();
    await openNoteFromExplorer(page, "Versioned note");

    // Edit → autosave (700ms debounce) snapshots the original content
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+ArrowDown");
    await page.keyboard.type(" Freshly edited.");
    await page.waitForTimeout(1_300);

    await page.keyboard.press("ControlOrMeta+p");
    const palette = page.getByRole("dialog");
    await palette.getByPlaceholder(/select a command/i).fill("version");
    await palette.getByText("Version history: Show version history").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Version history")).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("button", { name: "Restore" }).first()).toBeVisible({
      timeout: 10_000,
    });

    await dialog.getByRole("button", { name: "Restore" }).first().click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    await expect(editorSurface(page)).toContainText("Original text here.");
    await expect(editorSurface(page)).not.toContainText("Freshly edited.");
  });
});
