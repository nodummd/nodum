import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("incremental graph engine", () => {
  test("creating a note never re-randomizes the layout or jumps the view", async ({ page }) => {
    await signupFreshUser(page, "smooth");

    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    const anchor = page.locator(".nodum-graph-label", { hasText: "Welcome to Nodum" });
    await expect(anchor).toBeVisible({ timeout: 10_000 });
    // wait until the simulation has actually settled (label stops moving)
    let last = await anchor.boundingBox();
    await expect(async () => {
      await page.waitForTimeout(600);
      const now = await anchor.boundingBox();
      const moved = Math.hypot((now?.x ?? 0) - (last?.x ?? 0), (now?.y ?? 0) - (last?.y ?? 0));
      last = now;
      expect(moved).toBeLessThan(6);
    }).toPass({ timeout: 15_000 });
    const before = last;

    // Create a note (switcher force-create) — this opens the new note tab…
    await page.keyboard.press("ControlOrMeta+o");
    await page.getByPlaceholder("Find or create a note…").fill("Fresh smooth node");
    await page.getByPlaceholder("Find or create a note…").press("Shift+Enter");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Fresh smooth node",
      { timeout: 10_000 },
    );

    // …then return to the graph tab: layout must be WHERE WE LEFT IT
    await page.getByRole("tab", { name: /Graph view/ }).click();
    await expect(anchor).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    const after = await anchor.boundingBox();
    const drift = Math.hypot(
      (after?.x ?? 0) - (before?.x ?? 0),
      (after?.y ?? 0) - (before?.y ?? 0),
    );
    expect(drift).toBeLessThan(80);

    // the new note joined the graph (label present — small vault, all labeled)
    await expect(
      page.locator(".nodum-graph-label", { hasText: "Fresh smooth node" }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
