import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("canvas boards", () => {
  test("create canvas, add cards, connect edge, drag, reload persists", async ({ page }) => {
    await signupFreshUser(page, "canvas");

    // Create from the sidebar section
    await page.getByRole("button", { name: "New canvas" }).click();
    await page.getByLabel("Canvas name").fill("Plan board");
    await page.getByLabel("Canvas name").press("Enter");
    await expect(page.getByRole("tab", { name: /Plan board/ })).toBeVisible({ timeout: 10_000 });

    // Text card
    await page.getByRole("button", { name: "Text card" }).click();
    const textCard = page.locator('[data-canvas-card="text"]');
    await expect(textCard).toBeVisible();
    await textCard.dblclick();
    await page.getByLabel("Card text").fill("# Mission\nShip v3");
    await page.getByLabel("Card text").press("Escape");
    await expect(textCard).toContainText("Mission");

    // Note card via picker
    await page.getByRole("button", { name: "Note card" }).click();
    await page.getByLabel("Find a note for the canvas").fill("Welcome");
    await page
      .locator("[data-canvas-picker]")
      .getByRole("button", { name: "Welcome to Nodum", exact: true })
      .click();
    const noteCard = page.locator('[data-canvas-card="file"]');
    await expect(noteCard).toBeVisible();
    await expect(noteCard).toContainText("Welcome to Nodum", { timeout: 10_000 });

    // Connect: select text card, Shift+click note card
    await textCard.click();
    await noteCard.click({ modifiers: ["Shift"] });
    await expect(page.locator("[data-canvas-edge]")).toHaveCount(1);

    // Drag the text card and confirm it moved
    const before = await textCard.boundingBox();
    await textCard.hover();
    await page.mouse.down();
    await page.mouse.move((before?.x ?? 0) + 350, (before?.y ?? 0) + 220, { steps: 8 });
    await page.mouse.up();
    const after = await textCard.boundingBox();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(50);

    // Wait for the debounced save, then reload and reopen
    await page.waitForTimeout(1_200);
    await page.reload();
    // persisted workspace restores the canvas tab automatically
    await expect(page.getByRole("tab", { name: /Plan board/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-canvas-card="text"]')).toContainText("Mission", {
      timeout: 15_000,
    });
    await expect(page.locator('[data-canvas-card="file"]')).toBeVisible();
    await expect(page.locator("[data-canvas-edge]")).toHaveCount(1);
  });
});

test.describe("canvas background", () => {
  test("background style is user-choosable and persists", async ({ page }) => {
    await signupFreshUser(page, "canvas-bg");

    // Create a canvas
    await page.getByRole("button", { name: "New canvas" }).click();
    await page.getByLabel("Canvas name").fill("BG board");
    await page.getByLabel("Canvas name").press("Enter");
    const root = page.locator("[data-canvas-root]");
    await expect(root).toBeVisible({ timeout: 10_000 });
    // Default is dots
    await expect(root).toHaveAttribute("data-canvas-bg", "dots");

    // Change to grid via settings → Canvas tab
    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Canvas", exact: true }).click();
    await dialog.getByLabel("Canvas background").selectOption("grid");
    await expect(page.getByText("Vault settings saved.")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    // Applied live, and survives reload
    await expect(root).toHaveAttribute("data-canvas-bg", "grid", { timeout: 10_000 });
    await page.reload();
    await expect(page.locator("[data-canvas-root]")).toHaveAttribute("data-canvas-bg", "grid", {
      timeout: 15_000,
    });
  });
});
