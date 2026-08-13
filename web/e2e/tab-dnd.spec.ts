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
