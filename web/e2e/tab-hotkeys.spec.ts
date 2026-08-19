import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, openNoteInNewTab, signupFreshUser } from "./helpers";

/** ⌘/Ctrl+W closes the active tab, even with many tabs open. */
test.describe("tab keyboard shortcuts", () => {
  test("⌘W closes the active tab and activates its neighbor", async ({ page }) => {
    await signupFreshUser(page, "tab-hotkeys-e2e");

    // Open the three seeded notes as tabs, in order → [Welcome, Linking, Formatting]
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteInNewTab(page, "Linking your thinking");
    await openNoteInNewTab(page, "Formatting showcase");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);

    // Activate the middle tab, then close it with the keyboard
    await page.getByRole("tab", { name: /Linking your thinking/ }).click();
    const title = page.getByRole("textbox", { name: "Note title" });
    await expect(title).toHaveValue("Linking your thinking");

    await page.keyboard.press("ControlOrMeta+w");

    // The closed tab is gone and its right neighbor becomes active
    await expect(page.getByRole("tab", { name: /Linking your thinking/ })).toHaveCount(0);
    await expect(tabs).toHaveCount(2);
    await expect(title).toHaveValue("Formatting showcase");

    // Closing the last tab falls back to its left neighbor
    await page.keyboard.press("ControlOrMeta+w");
    await expect(tabs).toHaveCount(1);
    await expect(title).toHaveValue("Welcome to Nodum");
  });

  test("palette moves between tabs and closes the others", async ({ page }) => {
    await signupFreshUser(page, "tab-nav-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteInNewTab(page, "Linking your thinking");
    await openNoteInNewTab(page, "Formatting showcase");
    const title = page.getByRole("textbox", { name: "Note title" });
    await expect(title).toHaveValue("Formatting showcase"); // last opened is active

    // Go to previous tab via the command palette (browser-proof path)
    await page.keyboard.press("ControlOrMeta+p");
    await page.getByPlaceholder("Select a command...").fill("previous tab");
    await page.getByRole("option", { name: "Go to previous tab" }).click();
    await expect(title).toHaveValue("Linking your thinking");

    // Close all other tabs → only the active one remains
    await page.keyboard.press("ControlOrMeta+p");
    await page.getByPlaceholder("Select a command...").fill("Close all other");
    await page.getByRole("option", { name: "Close all other tabs" }).click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(title).toHaveValue("Linking your thinking");
  });

  test("⌘1 and ⌘9 jump to the first and last tab", async ({ page }) => {
    await signupFreshUser(page, "tab-index-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteInNewTab(page, "Linking your thinking");
    await openNoteInNewTab(page, "Formatting showcase");
    const title = page.getByRole("textbox", { name: "Note title" });
    await expect(title).toHaveValue("Formatting showcase");

    await page.keyboard.press("ControlOrMeta+1");
    await expect(title).toHaveValue("Welcome to Nodum");

    await page.keyboard.press("ControlOrMeta+9"); // ⌘9 = last tab
    await expect(title).toHaveValue("Formatting showcase");
  });

  test("⌘W leaves a pinned tab open", async ({ page }) => {
    await signupFreshUser(page, "tab-pin-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteInNewTab(page, "Linking your thinking");

    // Pin the active tab via its context menu
    await page.getByRole("tab", { name: /Linking your thinking/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin" }).click();
    const pinned = page.getByRole("tab", { name: /Linking your thinking/ });
    await expect(pinned).toBeVisible();

    // Re-activate it and try to close — pinned tabs are protected
    await pinned.click();
    await page.keyboard.press("ControlOrMeta+w");
    await expect(pinned).toHaveCount(1);
  });
});
