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

    await dialog.getByRole("button", { name: "Vault", exact: true }).click();
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

test.describe("settings tabs", () => {
  test("vertical tabs navigate and hold the migrated options", async ({ page }) => {
    await signupFreshUser(page, "settings-tabs-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });

    // General is the default tab — profile + password migrated here
    await expect(dialog.getByLabel("Display name")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Change password" })).toBeVisible();

    // Vault tab — daily notes + templates migrated here
    await dialog.getByRole("button", { name: "Vault", exact: true }).click();
    await expect(dialog.getByLabel("Date format")).toBeVisible();
    await expect(dialog.getByLabel("Templates folder")).toBeVisible();
    await expect(dialog.getByLabel("Display name")).toBeHidden();

    // Publish tab — site publishing migrated here
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /Publish vault site|Unpublish site/ })).toBeVisible();

    // Collab tab — live collaboration toggle migrated here, saves on change
    await dialog.getByRole("button", { name: "Collab", exact: true }).click();
    const collab = dialog.getByLabel("Live collaboration");
    await expect(collab).toBeVisible();
    await collab.check();
    await expect(page.getByText("Collaboration setting saved.")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("hotkeys reference", () => {
  test("search narrows the hotkey list", async ({ page }) => {
    await signupFreshUser(page, "hotkeys-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Hotkeys", exact: true }).click();

    const rows = dialog.locator("[data-hotkey-row]");
    const total = await rows.count();
    expect(total).toBeGreaterThan(15);

    await dialog.getByLabel("Search hotkeys").fill("graph");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(/Graph view/i);

    await dialog.getByLabel("Search hotkeys").fill("bold");
    await expect(rows.first()).toContainText("⌘B");

    await dialog.getByLabel("Search hotkeys").fill("zzz-no-match");
    await expect(rows).toHaveCount(0);
    await expect(dialog.getByText("No hotkeys match.")).toBeVisible();
  });
});
