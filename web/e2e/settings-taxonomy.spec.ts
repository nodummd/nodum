import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** S15.1 — Obsidian settings taxonomy: Interface tab, fonts, files & links. */
test.describe("settings taxonomy", () => {
  test("Interface tab: Show ribbon toggles the left ribbon", async ({ page }) => {
    await signupFreshUser(page, "interface-e2e");
    const ribbonBtn = page.getByRole("button", { name: "Command palette (⌘P)" });
    await expect(ribbonBtn).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Interface", exact: true }).click();
    await dialog.getByLabel("Show ribbon").uncheck();

    await expect(ribbonBtn).toBeHidden({ timeout: 10_000 });
  });

  test("Appearance: interface font applies live", async ({ page }) => {
    await signupFreshUser(page, "font-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
    await dialog.getByLabel("Interface font").selectOption("Inter");

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--font-interface").trim(),
          ),
        { timeout: 10_000 },
      )
      .toContain("Inter");
  });

  test("Files & links: new link format round-trips", async ({ page }) => {
    await signupFreshUser(page, "fileslinks-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Files & links", exact: true }).click();
    await dialog.getByLabel("New link format").selectOption("relative");
    await expect(page.getByText("Vault settings saved.").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await page.reload();
    // wait for the workspace to mount before the ⌘, shortcut
    await expect(page.getByRole("button", { name: "Command palette (⌘P)" })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("ControlOrMeta+Comma");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Files & links", exact: true }).click();
    await expect(dialog.getByLabel("New link format")).toHaveValue("relative", { timeout: 10_000 });
  });
});

test.describe("settings access", () => {
  test("the ribbon settings gear opens the settings window", async ({ page }) => {
    await signupFreshUser(page, "settings-gear-e2e");
    // A visible gear in the left ribbon opens settings (no keyboard needed)
    await page.getByRole("button", { name: "Settings (⌘,)" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
  });
});
