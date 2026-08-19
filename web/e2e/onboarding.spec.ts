import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** The first-run tour: it lights the real interface, every step can be left,
 *  leaving marks the account, and Help brings it back. */

test.describe("onboarding tour", () => {
  test("walks the workspace with a spotlight, and finishing is remembered", async ({ page }) => {
    await signupFreshUser(page, "tour", { keepFirstRun: true });
    const tour = page.getByTestId("tour");
    const card = page.getByTestId("tour-card");
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveAttribute("data-step", "welcome");

    await card.getByRole("button", { name: "Start" }).click();
    await expect(card).toHaveAttribute("data-step", "explorer");

    // The spotlight really tracks the element it names: the ring's box is
    // the explorer's box, padded.
    const ring = tour.locator("rect.tour-ring");
    const [ringBox, explorerBox] = await Promise.all([
      ring.boundingBox(),
      page.locator('[data-tour="explorer"]').boundingBox(),
    ]);
    expect(ringBox && explorerBox).toBeTruthy();
    expect(Math.abs(ringBox!.x - (explorerBox!.x - 8))).toBeLessThan(2);
    expect(Math.abs(ringBox!.width - (explorerBox!.width + 16))).toBeLessThan(2);

    // Keyboard drives it too.
    await page.keyboard.press("ArrowRight");
    await expect(card).toHaveAttribute("data-step", "editor");
    await page.keyboard.press("ArrowLeft");
    await expect(card).toHaveAttribute("data-step", "explorer");

    // Through to the end: Next ×4 → the demo question → Not now → done.
    for (const step of ["editor", "graph", "find", "panels", "demo"]) {
      await card.getByRole("button", { name: "Next" }).click();
      await expect(card).toHaveAttribute("data-step", step);
    }
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toHaveAttribute("data-step", "done");
    await card.getByRole("button", { name: "Finish" }).click();
    await expect(tour).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Welcome to Nodum").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tour")).toHaveCount(0);
  });

  test("Esc leaves via the one question that must be asked, and Help brings the tour back", async ({
    page,
  }) => {
    await signupFreshUser(page, "tour-esc", { keepFirstRun: true });
    const tour = page.getByTestId("tour");
    const card = page.getByTestId("tour-card");
    await expect(tour).toBeVisible({ timeout: 10_000 });

    // × / Esc from the first step: not gone, but on the demo question.
    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("data-step", "demo");
    await card.getByRole("button", { name: "Not now" }).click();
    // Once answered, Esc leaves outright.
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);

    // Help → the tour again, from the top; already answered, so Esc now exits.
    await page.getByRole("button", { name: "Help" }).click();
    await page.getByRole("menuitem", { name: "Show the tour again" }).click();
    await expect(card).toHaveAttribute("data-step", "welcome");
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
  });

  test("the tour never runs on a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signupFreshUser(page, "tour-mobile", { keepFirstRun: true });
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("tour")).toHaveCount(0);
    await context.close();
  });
});
