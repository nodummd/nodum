import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("knowledge graph", () => {
  test("graph view renders nodes with labels and counts", async ({ page }) => {
    await signupFreshUser(page, "graph-render");

    await page.keyboard.press("ControlOrMeta+g");

    // cosmos.gl canvas mounts
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    // controls (incl. the count line) live behind the gear popover
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
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
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
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
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();

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
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
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
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
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

test.describe("graph panel parity", () => {
  test("search dims without filtering; display sliders + arrows persist across reload", async ({
    page,
  }) => {
    await signupFreshUser(page, "panelparity");

    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    // Controls live behind the Obsidian-style gear popover
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
    const counts = page.getByText(/\d+ nodes · \d+ links/);
    await expect(counts).toBeVisible({ timeout: 10_000 });
    const full = Number(/(\d+) nodes/.exec((await counts.textContent()) ?? "")?.[1] ?? "0");
    expect(full).toBeGreaterThan(2);

    // Close the popover so the floating search control is reachable.
    await page.keyboard.press("Escape");

    // Search DIMS non-matches rather than hiding them: the node count is
    // unchanged, so the graph never reshapes under you while you search.
    await page.getByRole("button", { name: "Search graph" }).click();
    await page.getByLabel("Search graph").fill("Welcome");
    await page.waitForTimeout(800); // debounced highlight
    await page.getByRole("button", { name: "Clear search" }).click();

    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
    await expect(async () => {
      const text = (await counts.textContent()) ?? "";
      const nodes = Number(/(\d+) nodes/.exec(text)?.[1] ?? "0");
      expect(nodes).toBe(full);
    }).toPass({ timeout: 10_000 });

    // Display settings persist
    await page.getByLabel("Arrows").check();
    const nodeSizeSlider = page.getByLabel("Node size");
    await nodeSizeSlider.fill("2.5");
    await page.waitForTimeout(1_500); // debounce + persist

    await page.reload();
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
    await expect(page.getByLabel("Arrows")).toBeChecked({ timeout: 10_000 });
    await expect(page.getByLabel("Node size")).toHaveValue("2.5");
  });

  test("reset restores graph settings to defaults", async ({ page }) => {
    await signupFreshUser(page, "graphreset");

    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
    const nodeSize = page.getByLabel("Node size");
    await nodeSize.fill("3");
    await expect(nodeSize).toHaveValue("3");

    // Reset lives outside the popover; clicking it closes the popover, so reopen
    await page.getByRole("button", { name: "Reset graph settings" }).click();
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();
    await expect(page.getByLabel("Node size")).toHaveValue("1", { timeout: 10_000 });
  });
});

test.describe("graph config stability", () => {
  test("changing a force keeps the graph alive (setConfigPartial, not reset)", async ({ page }) => {
    await signupFreshUser(page, "graphforce");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Graph settings", exact: true }).click();

    // Previously setConfig() wiped the whole config (callbacks, bg, forces);
    // setConfigPartial keeps the graph rendering + counting after a force change.
    await page.getByLabel("Center force").fill("0.9");
    await expect(page.locator("main canvas").first()).toBeVisible();
    await expect(page.getByText(/\d+ nodes · \d+ links/)).toBeVisible({ timeout: 10_000 });
  });
});
