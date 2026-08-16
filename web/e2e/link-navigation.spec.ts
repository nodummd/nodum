import { expect, test, type Page } from "@playwright/test";

import { openNoteFromExplorer, signupFreshUser } from "./helpers";

/** Following a link reads the note in the tab you are already in — a vault
 *  visit should not leave a trail of tabs behind it. ⌘/Ctrl-click is what asks
 *  for a second tab, and the pane's back/forward arrows put back what a link
 *  navigated away from. */

const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const link = (page: Page, target: string) =>
  page.locator(`.cm-wikilink[data-wikilink-target="${target}"]`).first();

test.describe("link navigation", () => {
  test("a plain click follows the link in place; ⌘-click opens another tab", async ({ page }) => {
    await signupFreshUser(page, "linknav");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await expect(page.getByRole("tab")).toHaveCount(1);

    await link(page, "Linking your thinking").click();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 10_000 });
    // Still one tab — the note took over the one we were reading in.
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab")).toHaveText(/Linking your thinking/);

    await link(page, "Welcome to Nodum").click({ modifiers: ["ControlOrMeta"] });
    await expect(title(page)).toHaveValue("Welcome to Nodum", { timeout: 10_000 });
    await expect(page.getByRole("tab")).toHaveCount(2);
  });

  test("back puts the note you came from back, and forward returns", async ({ page }) => {
    await signupFreshUser(page, "linkback");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    const back = page.getByRole("button", { name: /Navigate back/ });
    const forward = page.getByRole("button", { name: /Navigate forward/ });
    await expect(back).toBeDisabled();

    await link(page, "Linking your thinking").click();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 10_000 });
    await expect(back).toBeEnabled();

    // The tab we came from no longer exists — Back has to re-open it.
    await back.click();
    await expect(title(page)).toHaveValue("Welcome to Nodum", { timeout: 10_000 });
    await expect(page.getByRole("tab")).toHaveCount(1);

    await forward.click();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 10_000 });
    await expect(page.getByRole("tab")).toHaveCount(1);
  });

  test("a pinned tab is never taken over", async ({ page }) => {
    await signupFreshUser(page, "linkpinned");
    await openNoteFromExplorer(page, "Welcome to Nodum");

    await page.getByRole("tab", { name: /Welcome to Nodum/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin" }).click();

    await link(page, "Linking your thinking").click();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 10_000 });
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: /Welcome to Nodum/ })).toBeVisible();
  });

  test("a note renamed after you left it comes back under its new name", async ({ page }) => {
    await signupFreshUser(page, "linkrename");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await link(page, "Linking your thinking").click();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 10_000 });

    await title(page).fill("Renamed target");
    await title(page).press("Enter");
    await expect(page.getByRole("tab", { name: /Renamed target/ })).toBeVisible({ timeout: 10_000 });

    // Back drops the tab; Forward rebuilds it from the history entry, which
    // must have been renamed too.
    await page.getByRole("button", { name: /Navigate back/ }).click();
    await expect(title(page)).toHaveValue("Welcome to Nodum", { timeout: 10_000 });
    await page.getByRole("button", { name: /Navigate forward/ }).click();
    await expect(page.getByRole("tab", { name: /Renamed target/ })).toBeVisible({ timeout: 10_000 });
  });

  test("the history survives a reload", async ({ page }) => {
    await signupFreshUser(page, "linkreload");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await link(page, "Linking your thinking").click();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 10_000 });

    await page.reload();
    await expect(title(page)).toHaveValue("Linking your thinking", { timeout: 15_000 });
    await page.getByRole("button", { name: /Navigate back/ }).click();
    await expect(title(page)).toHaveValue("Welcome to Nodum", { timeout: 10_000 });
  });
});
