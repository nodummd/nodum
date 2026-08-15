import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/** The selection-driven sections of the editor's right-click menu: linking,
 *  searching for the selected words, and the clipboard block. */

async function open(page: Page, prefix: string, content = "Rules that classify values.\n") {
  await signupFreshUser(page, prefix);
  await createNoteViaApi(page, "Target note", "I am linkable.\n");
  await createNoteViaApi(page, "Menu note", content);
  await page.reload();
  await openNoteFromExplorer(page, "Menu note");
  await editorSurface(page).locator(".cm-line").first().click();
}

/** Select the first `count` characters of the caret's line. */
async function selectFromLineStart(page: Page, count: number) {
  await page.keyboard.press("Home");
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+ArrowRight");
}

/** Right-click INSIDE the selection.
 *  The editor moves the caret to the pointer when you right-click outside the
 *  selection (so the menu acts on what you pointed at), which means clicking
 *  the middle of the line would collapse a selection made at its start. */
async function openMenu(page: Page) {
  await editorSurface(page)
    .locator(".cm-line")
    .first()
    .click({ button: "right", position: { x: 4, y: 8 } });
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  return menu;
}

async function sourceText(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Source mode" }).click();
  const text = await editorSurface(page).innerText();
  await page.getByRole("button", { name: "Live preview" }).click();
  return text;
}

test.describe("selection context menu", () => {
  test("the three sections appear in order", async ({ page }) => {
    await open(page, "selmenu-order");
    const menu = await openMenu(page);
    const labels = await menu.getByRole("menuitem").allTextContents();

    // 1 — linking and search on top.
    expect(labels[0]).toContain("Add link");
    expect(labels[1]).toContain("Add external link");
    expect(labels[2]).toContain("Search for");
    // 2 — formatting in the middle.
    expect(labels.indexOf("Format")).toBeGreaterThan(2);
    // 3 — clipboard at the bottom, in the requested order.
    const clip = labels.slice(-5).map((l) => l.replace(/⌘.*/, ""));
    expect(clip).toEqual(["Cut", "Copy", "Paste", "Paste in plain text", "Select all"]);
  });

  test("selection-only items are disabled without a selection", async ({ page }) => {
    await open(page, "selmenu-disabled");
    const menu = await openMenu(page);
    for (const name of [/^Search for/, /^Cut/, /^Copy/]) {
      await expect(menu.getByRole("menuitem", { name })).toHaveAttribute("data-disabled", "");
    }
    // Paste and Select all never depend on a selection.
    await expect(menu.getByRole("menuitem", { name: /^Paste/ }).first()).not.toHaveAttribute(
      "data-disabled",
      "",
    );
  });

  test("the search item names the selected words and seeds the sidebar", async ({ page }) => {
    await open(page, "selmenu-search");
    await selectFromLineStart(page, 5); // "Rules"

    const menu = await openMenu(page);
    const search = menu.getByRole("menuitem", { name: /^Search for/ });
    await expect(search).toContainText("Rules");
    await search.click();

    // The left sidebar switches to search, pre-filled with the word.
    await expect(page.getByPlaceholder(/search/i).first()).toHaveValue("Rules");
  });

  test("add link inserts a wikilink keeping the selected words as the alias", async ({ page }) => {
    await open(page, "selmenu-addlink");
    await selectFromLineStart(page, 5); // "Rules"

    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Add link", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Target note", exact: true }).click();

    expect(await sourceText(page)).toContain("[[Target note|Rules]]");
  });

  test("add external link wraps the selection in a markdown link", async ({ page }) => {
    await open(page, "selmenu-extlink");
    await selectFromLineStart(page, 5);

    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Add external link", exact: true }).click();

    const url = page.getByRole("textbox", { name: "Link URL" });
    await url.fill("https://example.com/x");
    await url.press("Enter");

    expect(await sourceText(page)).toContain("[Rules](https://example.com/x)");
  });

  test("copy puts the selection on the clipboard and cut removes it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "selmenu-clip");
    await selectFromLineStart(page, 5);

    let menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: /^Copy/ }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Rules");

    await editorSurface(page).locator(".cm-line").first().click();
    await selectFromLineStart(page, 5);
    menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: /^Cut/ }).click();
    expect(await sourceText(page)).not.toContain("Rules that");
  });

  test("paste in plain text strips markdown syntax", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "selmenu-plain");
    await page.evaluate(() => navigator.clipboard.writeText("## Heading with **bold** and [a](b)"));

    await page.keyboard.press("ControlOrMeta+a");
    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Paste in plain text" }).click();

    const text = await sourceText(page);
    expect(text).toContain("Heading with bold and a");
    expect(text).not.toContain("**");
    expect(text).not.toContain("##");
  });
});
