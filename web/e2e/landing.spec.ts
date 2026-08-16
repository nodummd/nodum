import { expect, test } from "@playwright/test";

/** The public surface: landing + the two auth pages. */
test.describe("landing page", () => {
  test("hero, logo and product shot all render; CTA reaches signup", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Notes are the knots/i })).toBeVisible({
      timeout: 15_000,
    });

    // The logo is the hero. Assert it actually decoded — a <picture> whose
    // AVIF source fails leaves a blank hero rather than falling back.
    const knot = page.locator("main img").first();
    await expect(knot).toBeVisible();
    await expect
      .poll(() => knot.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 })
      .toBeGreaterThan(0);

    await page.getByRole("link", { name: "Start your vault" }).first().click();
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByRole("heading", { name: "Create your vault" })).toBeVisible();
  });

  test("the demo vault runs, and colouring a folder recolours its notes", async ({ page }) => {
    await page.goto("/");
    await page.locator("#workspace").scrollIntoViewIfNeeded();

    // The engine loads lazily and the layout needs a moment to settle.
    const label = page.locator(".nodum-demo-label", { hasText: "Knowledge graphs" });
    await expect(label).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".mk-demo canvas")).toBeVisible();

    // Research starts azure; its notes are drawn in that colour.
    await expect(label).toHaveCSS("color", "rgb(55, 144, 255)", { timeout: 10_000 });

    // Journal starts uncoloured — give it one and its note follows.
    const journalNote = page.locator(".nodum-demo-label", { hasText: "Daily notes" });
    await expect(journalNote).toHaveCSS("color", "rgb(143, 138, 166)");
    await page.getByRole("button", { name: "Colour the Journal folder" }).click();
    await page.getByRole("button", { name: "Amber", exact: true }).click();
    // The picker collapses under the pointer, leaving a row hovered — and a
    // hovered note is drawn in the highlight colour, not its folder's.
    await page.mouse.move(0, 0);
    await expect(journalNote).toHaveCSS("color", "rgb(247, 183, 49)", { timeout: 10_000 });

    // Hovering a file in the explorer picks its node out of the graph.
    await page.getByRole("button", { name: "Zettelkasten", exact: true }).hover();
    await expect(page.locator(".nodum-demo-label", { hasText: "Zettelkasten" })).toHaveCSS(
      "color",
      "rgb(236, 233, 245)",
      { timeout: 10_000 },
    );
  });

  test("log in page shows the brand panel and the form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    // The password toggle must not be named "…password": the auth suite reaches
    // the field with getByLabel("Password") and a second match breaks it.
    await page.getByLabel("Password").fill("hunter2");
    await page.getByRole("button", { name: "Show characters" }).click();
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "text");

    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
});
