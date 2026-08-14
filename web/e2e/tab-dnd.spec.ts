import { expect, test } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** S13.2 — tab drag-and-drop: reorder, move between panes, edge-split. */
test.describe("tab drag-and-drop", () => {
  test("dragging a tab to the right edge splits side-by-side", async ({ page }) => {
    await signupFreshUser(page, "dnd-right");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteFromExplorer(page, "Linking your thinking");
    await expect(page.locator(".cm-content")).toHaveCount(1, { timeout: 10_000 });

    const tab = page.getByRole("tab", { name: /Linking your thinking/ });
    const pane = page.getByRole("region", { name: "Editor pane 1" });
    const box = (await pane.boundingBox())!;
    await tab.dragTo(pane, { targetPosition: { x: box.width - 24, y: box.height / 2 } });

    await expect(page.locator(".cm-content")).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByRole("region", { name: "Editor pane 2" })).toBeVisible();
    // side-by-side → vertical resize seam
    await expect(page.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
  });

  test("dragging a tab to the bottom edge splits stacked", async ({ page }) => {
    await signupFreshUser(page, "dnd-bottom");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteFromExplorer(page, "Linking your thinking");
    await expect(page.locator(".cm-content")).toHaveCount(1, { timeout: 10_000 });

    const tab = page.getByRole("tab", { name: /Linking your thinking/ });
    const pane = page.getByRole("region", { name: "Editor pane 1" });
    const box = (await pane.boundingBox())!;
    await tab.dragTo(pane, { targetPosition: { x: box.width / 2, y: box.height - 24 } });

    await expect(page.locator(".cm-content")).toHaveCount(2, { timeout: 10_000 });
    // stacked → horizontal resize seam
    await expect(page.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
  });

  test("reordering a tab within its strip", async ({ page }) => {
    await signupFreshUser(page, "dnd-reorder");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteFromExplorer(page, "Linking your thinking");
    await openNoteFromExplorer(page, "Formatting showcase");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    // Drag the last tab onto the first tab → it lands at the front
    await tabs.nth(2).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: 12 } });
    await expect(tabs.first()).toContainText("Formatting showcase");
  });
});

test.describe("tab drag-and-drop dedupe", () => {
  test("moving a tab into a pane that already has it doesn't duplicate or crash", async ({
    page,
  }) => {
    const keyErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /same key/i.test(m.text())) keyErrors.push(m.text());
    });

    await signupFreshUser(page, "dnd-dedup");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    // Open the graph, then split → the graph tab now lives in BOTH panes
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.getByRole("tab", { name: /Graph view/ })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+\\");
    await expect(page.getByRole("region", { name: "Editor pane 2" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("tab", { name: /Graph view/ })).toHaveCount(2);

    // Drag pane 2's graph tab onto pane 1 (which already has a graph tab)
    const pane2Graph = page
      .getByRole("region", { name: "Editor pane 2" })
      .getByRole("tab", { name: /Graph view/ });
    const pane1Welcome = page
      .getByRole("region", { name: "Editor pane 1" })
      .getByRole("tab", { name: /Welcome to Nodum/ });
    await pane2Graph.dragTo(pane1Welcome);

    // Collapses to one pane with exactly one graph tab, no key-collision error
    await expect(page.getByRole("tab", { name: /Graph view/ })).toHaveCount(1, { timeout: 10_000 });
    expect(keyErrors).toEqual([]);
  });
});
