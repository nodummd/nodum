import { expect, test, type Page } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** Pointing at a note anywhere in the app (an explorer row, a link in the
 *  editor) makes its node breathe in the open graph. The swell and the accent
 *  glow live in WebGL; what is assertable from the DOM is the label, which the
 *  render loop force-shows and marks while the node is pulsing. */

const pulsed = (page: Page) => page.locator(".nodum-graph-label[data-hover-pulse]");

/** Wait until the camera actually frames the layout — labels off-screen are
 *  culled, so before the first fit there is nothing to mark. */
async function waitForVisibleLabels(page: Page) {
  await expect(page.locator(".nodum-graph-label").first()).toBeAttached({ timeout: 15_000 });
  await expect(async () => {
    const opacities = await page
      .locator(".nodum-graph-label")
      .evaluateAll((els) => els.map((el) => parseFloat((el as HTMLElement).style.opacity || "0")));
    expect(Math.max(...opacities)).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });
}

test.describe("graph hover highlight", () => {
  test("hovering a file in the explorer breathes its node", async ({ page }) => {
    await signupFreshUser(page, "graphhover");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await waitForVisibleLabels(page);

    await expect(pulsed(page)).toHaveCount(0);

    await page.getByText("Formatting showcase", { exact: true }).first().hover();
    await expect(pulsed(page)).toHaveText("Formatting showcase", { timeout: 5_000 });

    // Nothing else is touched: every other label keeps its own opacity, so the
    // graph is highlighted, not dimmed.
    const hidden = await page
      .locator(".nodum-graph-label:not([data-hover-pulse])")
      .evaluateAll((els) => els.map((el) => parseFloat((el as HTMLElement).style.opacity || "0")));
    expect(Math.max(...hidden)).toBeGreaterThan(0);

    // Leaving the row clears it.
    await page.getByRole("button", { name: "Reset graph settings" }).hover();
    await expect(pulsed(page)).toHaveCount(0, { timeout: 5_000 });
  });

  test("hovering a link in the editor breathes the note it points at", async ({ page }) => {
    await signupFreshUser(page, "linkhover");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    // Graph beside the note: the split makes the new pane active, so ⌘G opens
    // the graph there and leaves the editor showing on the left.
    await page.keyboard.press("ControlOrMeta+\\");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await waitForVisibleLabels(page);

    const link = page.locator('.cm-wikilink[data-wikilink-target="Linking your thinking"]').first();
    await expect(link).toBeVisible();
    await link.hover();
    await expect(pulsed(page)).toHaveText("Linking your thinking", { timeout: 5_000 });

    // Moving off the link (still inside the note) clears it.
    await page.getByRole("textbox", { name: "Note title" }).hover();
    await expect(pulsed(page)).toHaveCount(0, { timeout: 5_000 });
  });
});
