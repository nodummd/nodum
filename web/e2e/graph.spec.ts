import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("knowledge graph", () => {
  test("graph view renders nodes with labels and counts", async ({ page }) => {
    await signupFreshUser(page, "graph-render");

    await page.keyboard.press("ControlOrMeta+g");

    // cosmos.gl canvas mounts
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    // controls card shows real counts (welcome vault: 4+ nodes incl. ghost)
    await expect(page.getByText(/[1-9]\d* nodes · \d+ links/)).toBeVisible({ timeout: 15_000 });
    // label overlay carries note titles
    await expect(page.locator(".nodum-graph-label", { hasText: "Welcome to Nodum" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("graph filters adjust node counts", async ({ page }) => {
    await signupFreshUser(page, "graph-filter");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.getByText(/nodes · \d+ links/)).toBeVisible({ timeout: 15_000 });

    const countText = async () =>
      (await page.getByText(/\d+ nodes · \d+ links/).textContent()) ?? "";

    const before = await countText();
    // Hide unresolved ghosts ("Existing files only") — welcome vault has 1 ghost
    await page.getByText("Existing files only").locator("input").check();
    await expect(async () => {
      expect(await countText()).not.toBe(before);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("graph groups", () => {
  test("adding a group recolors matching nodes and survives reload", async ({ page }) => {
    await signupFreshUser(page, "graph-groups");

    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "+ Add group" }).click();
    await page.getByLabel("Group 1 query").fill("Welcome");

    // The matched node's label picks up the group color (palette[0] = #eb3b5a)
    const label = page.locator(".nodum-graph-label", { hasText: "Welcome to Nodum" });
    await expect(label).toHaveCSS("color", "rgb(235, 59, 90)", { timeout: 10_000 });

    // Debounced persist (800ms) → reload → settings.graph restores the group
    await page.waitForTimeout(1_500);
    await page.reload();
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Group 1 query")).toHaveValue("Welcome", { timeout: 10_000 });
    await expect(
      page.locator(".nodum-graph-label", { hasText: "Welcome to Nodum" }),
    ).toHaveCSS("color", "rgb(235, 59, 90)", { timeout: 10_000 });
  });
});

test.describe("graph time travel", () => {
  test("slider hides newer notes; play restores the full graph", async ({ page }) => {
    await signupFreshUser(page, "timetravel");

    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    const counts = page.getByText(/\d+ nodes · \d+ links/);
    await expect(counts).toBeVisible({ timeout: 10_000 });
    const fullText = (await counts.textContent()) ?? "";
    const fullNodes = Number(/(\d+) nodes/.exec(fullText)?.[1] ?? "0");
    expect(fullNodes).toBeGreaterThan(2);

    // Reveal only the first quarter of the vault's history
    await page.getByLabel("Time travel").fill("25");
    await expect(async () => {
      const text = (await counts.textContent()) ?? "";
      const nodes = Number(/(\d+) nodes/.exec(text)?.[1] ?? "0");
      expect(nodes).toBeLessThan(fullNodes);
      expect(nodes).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10_000 });

    // Play runs the reveal back to the present
    await page.getByRole("button", { name: "Replay vault growth" }).click();
    await expect(async () => {
      const text = (await counts.textContent()) ?? "";
      expect(Number(/(\d+) nodes/.exec(text)?.[1] ?? "0")).toBe(fullNodes);
    }).toPass({ timeout: 20_000 });
  });
});
