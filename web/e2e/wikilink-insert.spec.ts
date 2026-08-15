import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/** Inserting and displaying wikilinks: the completion must not double the
 *  closing brackets, and a path-style link shows the note name, not the path. */

async function open(page: Page, prefix: string, content: string) {
  await signupFreshUser(page, prefix);
  await createNoteViaApi(page, "Caching", "Hot data close by.\n");
  await createNoteViaApi(page, "Link note", content);
  await page.reload();
  await openNoteFromExplorer(page, "Link note");
}

async function sourceText(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Source mode" }).click();
  const text = await editorSurface(page).innerText();
  await page.getByRole("button", { name: "Live preview" }).click();
  return text;
}

test.describe("wikilinks", () => {
  test("accepting a completion does not double the closing brackets", async ({ page }) => {
    await open(page, "wl-brackets", "start\n");
    await editorSurface(page).locator(".cm-line").first().click();
    await page.keyboard.press("ControlOrMeta+ArrowRight");

    // closeBrackets auto-closes as soon as `[` is typed, so by the time the
    // completion applies there is already a `]]` waiting after the caret.
    await page.keyboard.type(" [[Cach");
    // Click the option rather than pressing Enter: the completion list is
    // populated by an async search, and a keypress can land while it is still
    // settling.
    const option = page.locator(".cm-tooltip-autocomplete li").filter({ hasText: "Caching" });
    await expect(option.first()).toBeVisible({ timeout: 5000 });
    await option.first().click();

    const text = await sourceText(page);
    expect(text).not.toContain("]]]]");
    expect(text).toContain("[[Caching]]");
  });

  test("a path-style link displays only the note name", async ({ page }) => {
    await open(page, "wl-display", "See [[Topics/Computer Science/Caching]] here.\n");
    const link = editorSurface(page).locator(".cm-wikilink").first();
    // The folders are still in the source — they disambiguate — but the reader
    // sees the note.
    await expect(link).toHaveText("Caching");
    expect(await sourceText(page)).toContain("[[Topics/Computer Science/Caching]]");
  });

  test("an alias still wins over the path", async ({ page }) => {
    await open(page, "wl-alias", "See [[Topics/Computer Science/Caching|the cache note]].\n");
    await expect(editorSurface(page).locator(".cm-wikilink").first()).toHaveText("the cache note");
  });

  test("moving the caret into the link reveals the full path, so it can be retargeted", async ({
    page,
  }) => {
    await open(page, "wl-edit", "See [[Topics/Computer Science/Caching]] here.\n");
    const surface = editorSurface(page);
    await expect(surface.locator(".cm-wikilink").first()).toHaveText("Caching");

    // Clicking the link NAVIGATES — that is what a link is for. Retargeting is
    // done by walking the caret into it, which reveals the source.
    await surface.locator(".cm-line").first().click();
    await page.keyboard.press("ControlOrMeta+ArrowRight");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");

    await expect(surface).toContainText("Topics/Computer Science/Caching");
  });
});
