import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("quick switcher extras", () => {
  test("Shift+Enter force-creates even when the query matches a note", async ({ page }) => {
    await signupFreshUser(page, "switcher-force");

    await page.keyboard.press("ControlOrMeta+o");
    const input = page.getByPlaceholder("Find or create a note…");
    await input.fill("Welcome");
    // "Welcome to Nodum" matches — plain Enter would open it; ⇧↵ creates "Welcome"
    await input.press("Shift+Enter");

    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome", {
      timeout: 10_000,
    });
  });

  test("⌘Enter opens the match in the background without switching tabs", async ({ page }) => {
    await signupFreshUser(page, "switcher-bg");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    await page.keyboard.press("ControlOrMeta+o");
    const input = page.getByPlaceholder("Find or create a note…");
    await input.fill("Formatting showcase");
    await expect(
      page.getByRole("dialog").getByText("Formatting showcase").first(),
    ).toBeVisible({ timeout: 10_000 });
    await input.press("ControlOrMeta+Enter");

    // Switcher closed; active note unchanged; the new tab exists unselected
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Welcome to Nodum",
    );
    const bgTab = page.getByRole("tab", { name: /Formatting showcase/ });
    await expect(bgTab).toBeVisible();
    await expect(bgTab).toHaveAttribute("aria-selected", "false");
  });
});
