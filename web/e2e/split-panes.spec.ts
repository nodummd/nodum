import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("split panes", () => {
  test("⌘\\ splits right; panes hold different notes; closing empties the pane", async ({
    page,
  }) => {
    await signupFreshUser(page, "split");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    // Split: second pane appears holding the same tab, and becomes active
    await page.keyboard.press("ControlOrMeta+\\");
    await expect(page.getByRole("tab", { name: /Welcome to Nodum/ })).toHaveCount(2);
    await expect(page.locator(".cm-content")).toHaveCount(2);

    // Quick switcher opens into the ACTIVE (right) pane
    await page.keyboard.press("ControlOrMeta+o");
    await page.getByPlaceholder("Find or create a note…").fill("Formatting showcase");
    await expect(
      page.getByRole("dialog").getByText("Formatting showcase").first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("Find or create a note…").press("Enter");

    // Right pane now shows Formatting showcase; left still Welcome
    await expect(page.getByRole("tab", { name: /Formatting showcase/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Welcome to Nodum/ })).toHaveCount(2);
    const editors = page.locator(".cm-content");
    await expect(editors).toHaveCount(2);
    await expect(editors.nth(1)).toContainText("Formatting", { timeout: 10_000 });
    await expect(editors.first()).toContainText("Welcome to Nodum");

    // Closing the right pane's tabs collapses the split
    await page.getByRole("button", { name: "Close Formatting showcase" }).click();
    await page.getByRole("button", { name: "Close Welcome to Nodum" }).nth(1).click();
    await expect(page.getByRole("tab", { name: /Welcome to Nodum/ })).toHaveCount(1);
    await expect(page.locator(".cm-content")).toHaveCount(1);
  });
});
