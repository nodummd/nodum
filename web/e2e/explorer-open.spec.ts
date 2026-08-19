import { expect, test } from "@playwright/test";

import {
  createNoteViaApi,
  editorSurface,
  openNoteFromExplorer,
  openNoteInNewTab,
  signupFreshUser,
} from "./helpers";

/** Obsidian's explorer: a click reads the note where you are; ⌘-click opens
 *  another tab; a pinned tab is never taken over. And [[Note#Heading]] lands
 *  on the heading, not the top of the note. */

test.describe("explorer opening", () => {
  test("click reuses the current tab, ⌘-click adds one, a pinned tab is kept", async ({ page }) => {
    await signupFreshUser(page, "explorer-open");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await expect(page.getByRole("tab")).toHaveCount(1);
    await openNoteFromExplorer(page, "Linking your thinking");
    // Same tab, new note.
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab")).toHaveText(/Linking your thinking/);

    await openNoteInNewTab(page, "Formatting showcase");
    await expect(page.getByRole("tab")).toHaveCount(2);

    // Pin the active tab: a plain click must not replace it.
    await page.getByRole("tab", { name: /Formatting showcase/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin" }).click();
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tab", { name: /Formatting showcase/ })).toHaveCount(1);
  });

  test("[[Note#Heading]] scrolls to the heading in live preview and in reading view", async ({
    page,
  }) => {
    await signupFreshUser(page, "heading-link");
    const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of filler text.`).join("\n\n");
    await createNoteViaApi(page, "Long target", `# Long target\n\n${filler}\n\n## Deep section\n\nYou found it.\n\n${filler}`);
    await createNoteViaApi(page, "Jumper", "Go to [[Long target#Deep section]] now.");
    await page.reload();
    await openNoteFromExplorer(page, "Jumper");
    await page.locator(".cm-wikilink, [data-wikilink-target]").first().click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Long target", {
      timeout: 10_000,
    });
    // The heading line is in view and the caret sits on it.
    const headingLine = page.locator(".cm-line", { hasText: "Deep section" }).first();
    await expect(headingLine).toBeInViewport({ timeout: 5_000 });
    const top = await headingLine.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(400);

    // Reading view: same link, same landing.
    await openNoteFromExplorer(page, "Jumper");
    await page.getByRole("button", { name: "Reading view" }).click();
    await page.locator(".nodum-reading a.internal-link").first().click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Long target", {
      timeout: 10_000,
    });
    const h2 = page.locator(".nodum-reading h2", { hasText: "Deep section" }).first();
    await expect(h2).toBeInViewport({ timeout: 5_000 });
  });
});
