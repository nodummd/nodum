import { expect, test, type Page } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** The note you are working in, and any note you point at elsewhere in the app
 *  (an explorer row, a link in the editor), breathe in the open graph. The swell
 *  and the accent glow live in WebGL; what is assertable from the DOM is the
 *  label, which the render loop force-shows and marks while the node pulses. */

const pulsed = (page: Page) => page.locator(".nodum-graph-label[data-pulse]");

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

test.describe("graph focus highlight", () => {
  test("the note the caret is in breathes, and stops the moment focus leaves", async ({ page }) => {
    await signupFreshUser(page, "graphfocus");
    await openNoteFromExplorer(page, "Formatting showcase");

    // Graph beside the note: the split makes the new pane active, so ⌘G opens
    // the graph there and leaves the editor showing on the left.
    await page.keyboard.press("ControlOrMeta+\\");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await waitForVisibleLabels(page);

    // Opening a note is not the same as working in it — nothing breathes until
    // the caret is actually in the editor.
    await page.mouse.move(2, 2);
    await expect(pulsed(page)).toHaveCount(0);

    await page.locator(".cm-content").first().click();
    await expect(pulsed(page)).toHaveText(["Formatting showcase"], { timeout: 5_000 });

    // Click away — into the graph, the sidebar, anywhere — and it stops.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(pulsed(page)).toHaveCount(0, { timeout: 5_000 });
  });

  test("closing the note stops its node breathing", async ({ page }) => {
    await signupFreshUser(page, "graphclose");
    await openNoteFromExplorer(page, "Formatting showcase");
    await page.keyboard.press("ControlOrMeta+\\");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await waitForVisibleLabels(page);

    await page.locator(".cm-content").first().click();
    await expect(pulsed(page)).toHaveText(["Formatting showcase"], { timeout: 5_000 });

    // ⌘W with the caret still in the text: the editor is removed, and removing
    // a focused element fires no blur, so only the unmount can clear this.
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.locator(".cm-content")).toHaveCount(0, { timeout: 10_000 });
    await expect(pulsed(page)).toHaveCount(0, { timeout: 5_000 });
  });

  test("a highlight dims the rest of the graph without switching it off", async ({ page }) => {
    await signupFreshUser(page, "graphdim");
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
    await waitForVisibleLabels(page);

    // The graph search drives the same highlight that hovering and dragging a
    // node do (applyHighlight → forceLabels + link dimming), and unlike WebGL
    // hit-testing it is deterministic to trigger.
    await page.getByRole("button", { name: "Search graph" }).click();
    await page.getByLabel("Search graph").fill("Formatting showcase");

    const opacities = () =>
      page
        .locator(".nodum-graph-label")
        .evaluateAll((els) => els.map((el) => parseFloat((el as HTMLElement).style.opacity || "0")));

    await expect(async () => {
      const values = await opacities();
      // The match is fully lit…
      expect(Math.max(...values)).toBe(1);
      // …and the rest of the graph is dimmed but still readable. Names that
      // lost their space to a more important one are not drawn at all (see the
      // level-of-detail pass), so the contract is about the ones that are: none
      // of them competes with the match, and none is dimmed to illegibility.
      const rest = values.filter((v) => v > 0 && v < 1);
      expect(rest.length).toBeGreaterThan(0);
      expect(Math.min(...rest)).toBeGreaterThan(0.1);
      expect(Math.max(...rest)).toBeLessThan(0.5);
    }).toPass({ timeout: 10_000 });
  });
});

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
      .locator(".nodum-graph-label:not([data-pulse])")
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
    await expect(pulsed(page)).toHaveText(["Linking your thinking"], { timeout: 5_000 });

    // Moving off the link (still inside the note) clears it.
    await page.getByRole("textbox", { name: "Note title" }).hover();
    await expect(pulsed(page)).toHaveCount(0, { timeout: 5_000 });
  });
});
