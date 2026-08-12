import { expect, test } from "@playwright/test";

import { editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("callouts", () => {
  test("live preview styles callout lines with icon header", async ({ page }) => {
    await signupFreshUser(page, "callout-live");
    await openNoteFromExplorer(page, "Formatting showcase");

    await expect(page.locator(".cm-callout-line").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".cm-callout-header").first()).toContainText("Callouts");
  });

  test("reading view renders typed callout boxes; unknown types fall back", async ({ page }) => {
    await signupFreshUser(page, "callout-read");

    // Create a note exercising type, alias, foldable and unknown callouts
    await page.keyboard.press("ControlOrMeta+o");
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/find or create/i).fill("Callout zoo");
    await dialog.getByText(/Create\s+“Callout zoo”/).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Callout zoo", {
      timeout: 10_000,
    });

    await editorSurface(page).click();
    await page.keyboard.type(
      [
        "> [!warning] Watch out",
        "> Danger ahead.",
        "",
        "> [!tldr]",
        "> Alias resolves to abstract.",
        "",
        "> [!custom] Mystery",
        "> Unknown falls back to note styling.",
      ].join("\n"),
    );
    await page.waitForTimeout(1_200); // autosave

    await page.getByRole("button", { name: "Reading view" }).click();

    const warning = page.locator('[data-callout="warning"]');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText("Watch out");
    await expect(warning).toContainText("Danger ahead.");

    await expect(page.locator('[data-callout="tldr"]')).toContainText("Abstract");
    await expect(page.locator('[data-callout="custom"]')).toContainText("Mystery");

    await page.getByRole("button", { name: "Live preview" }).click();
  });
});
