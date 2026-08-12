import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("bookmarks", () => {
  test("star a note, see it in the bookmarks pane, unstar", async ({ page }) => {
    await signupFreshUser(page, "bm-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    await page.getByRole("button", { name: "Bookmark this note" }).click();
    await expect(page.getByRole("button", { name: "Remove bookmark" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
    const paneEntry = page.getByRole("button", { name: /Welcome to Nodum/ }).first();
    await expect(paneEntry).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Remove bookmark" }).click();
    await expect(
      page.getByText(/No bookmarks yet/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("settings", () => {
  test("⌘, opens settings; vault daily-note settings persist", async ({ page }) => {
    await signupFreshUser(page, "settings-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });

    await dialog.getByRole("textbox", { name: "Folder", exact: true }).fill("Journal");
    await dialog.getByRole("button", { name: "Save vault settings" }).click();
    await expect(page.getByText("Vault settings saved.")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    // Daily note now lands inside Journal/
    await page.getByRole("button", { name: "Open today's daily note" }).click();
    const title = page.getByRole("textbox", { name: "Note title" });
    await expect(title).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Journal", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
