import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** S11.2 — editor settings actually change the editor, live. */
test.describe("editor settings", () => {
  test("line numbers, font size and default view mode apply", async ({ page }) => {
    await signupFreshUser(page, "editor-settings-e2e");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 10_000 });

    // Baseline: no gutter, 16px
    await expect(page.locator(".cm-gutters")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Editor", exact: true }).click();

    // Line numbers → CM6 gutter appears live
    await dialog.getByLabel("Show line numbers").check();
    await expect(page.getByText("Editor settings saved.").first()).toBeVisible({ timeout: 10_000 });

    // Font size 20px → computed style follows
    await dialog.getByLabel("Editor font size").fill("20");

    // Default view for new tabs → reading
    await dialog.getByLabel("Default view for new tabs").selectOption("reading");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expect(page.locator(".cm-gutters")).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(
        () =>
          page
            .locator(".cm-content")
            .first()
            .evaluate((el) => getComputedStyle(el).fontSize),
        { timeout: 10_000 },
      )
      .toBe("20px");

    // A genuinely new tab opens in reading view
    await page.keyboard.press("ControlOrMeta+o");
    await page.getByPlaceholder("Find or create a note…").fill("Reading mode note");
    await page.keyboard.press("Shift+Enter");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Reading mode note",
      { timeout: 10_000 },
    );
    await expect(page.getByRole("button", { name: "Reading view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Settings survive a reload (server-side persistence, not local state)
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("ControlOrMeta+Comma");
    await dialog.getByRole("button", { name: "Editor", exact: true }).click();
    await expect(dialog.getByLabel("Show line numbers")).toBeChecked();
    await expect(dialog.getByLabel("Editor font size")).toHaveValue("20");
    await expect(dialog.getByLabel("Default view for new tabs")).toHaveValue("reading");
  });
});
