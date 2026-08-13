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

test.describe("split divider", () => {
  test("dragging the seam resizes panes and the ratio persists", async ({ page }) => {
    await signupFreshUser(page, "split-divider");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await page.keyboard.press("ControlOrMeta+\\");

    const pane1 = page.getByRole("region", { name: "Editor pane 1" });
    const pane2 = page.getByRole("region", { name: "Editor pane 2" });
    await expect(pane2).toBeVisible({ timeout: 10_000 });
    const before = (await pane1.boundingBox())!.width;

    const sep = page.getByRole("separator", { name: "Resize split" });
    const box = (await sep.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await pane1.boundingBox())!.width;
    expect(after).toBeLessThan(before - 80);

    // Ratio survives a reload
    await page.reload();
    await expect(page.getByRole("separator", { name: "Resize split" })).toBeVisible({
      timeout: 15_000,
    });
    const afterReload = (await page.getByRole("region", { name: "Editor pane 1" }).boundingBox())!
      .width;
    expect(Math.abs(afterReload - after)).toBeLessThan(48);
  });
});
