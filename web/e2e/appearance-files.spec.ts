import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** S11.3 — appearance + files & links settings actually work. */
test.describe("appearance & files settings", () => {
  test("accent colour applies live and survives reload", async ({ page }) => {
    await signupFreshUser(page, "accent-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
    await dialog.getByLabel("Accent colour", { exact: true }).fill("#22c55e");
    await expect(page.getByText("Editor settings saved.").first()).toBeVisible({ timeout: 10_000 });

    // The primary button in the dialog picks up the accent live
    await dialog.getByRole("button", { name: "General", exact: true }).click();
    const saveProfile = dialog.getByRole("button", { name: "Save profile" });
    await expect
      .poll(() => saveProfile.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(34, 197, 94)");

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: "New note" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--ob-interactive-accent"),
        ),
      )
      .toContain("#22c55e");
  });

  test("new notes land in the configured folder", async ({ page }) => {
    await signupFreshUser(page, "note-location-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Files & links", exact: true }).click();
    await dialog.getByLabel("Default location for new notes").selectOption("folder");
    await expect(page.getByText("Vault settings saved.").first()).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("New note folder").fill("Inbox");
    await expect(page.getByText("Vault settings saved.").nth(1)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+o");
    await page.getByPlaceholder("Find or create a note…").fill("Filed by default");
    await page.keyboard.press("Shift+Enter");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Filed by default",
      { timeout: 10_000 },
    );

    // The explorer now shows the auto-created Inbox folder
    await expect(page.getByText("Inbox", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("delete asks for confirmation by default", async ({ page }) => {
    await signupFreshUser(page, "confirm-delete-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    await page.getByText("Welcome to Nodum", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Are you sure?")).toBeVisible({ timeout: 10_000 });
    await expect(confirm.getByText(/Delete “Welcome to Nodum”/)).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();

    // Gone from both the explorer and the (auto-closed) editor tab
    await expect(page.getByText("Welcome to Nodum", { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
