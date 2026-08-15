import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/**
 * The editor's right-click formatting menu. Every assertion reads the RAW
 * markdown (source mode) — live preview hides the very markers these commands
 * write, so asserting against the rendered text would pass on a no-op.
 */

/** Open the context menu over a given line of the editor and return its root.
 *  Right-clicking a specific line matters: the editor moves the caret to the
 *  click position (as Obsidian does), so the target line IS the command's target. */
async function openMenu(page: Page, line = 0) {
  await editorSurface(page).locator(".cm-line").nth(line).click({ button: "right" });
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  return menu;
}

/** Walk into a submenu and click one of its commands.
 *  The trigger is CLICKED, not hovered: Radix opens sub-content on hover only
 *  after a pointer-intent delay that Playwright's synthetic move never satisfies. */
async function choose(page: Page, submenu: string, command: string, line = 0) {
  const menu = await openMenu(page, line);
  await menu.getByRole("menuitem", { name: submenu, exact: true }).click();
  // Scope to the sub-content that just opened (portalled last). Searching the
  // whole page would match same-named items in the parent menu — "Table"
  // exists both as the Insert command and as the top-level group.
  const sub = page.getByRole("menu").last();
  // Toggleable commands are menuitemcheckbox, not menuitem — match either, and
  // anchor on the label only since names carry the shortcut hint ("Bold ⌘B").
  const item = sub
    .locator('[role="menuitem"], [role="menuitemcheckbox"]')
    .filter({ hasText: new RegExp(`^${escapeRe(command)}`) })
    .first();
  await expect(item).toBeVisible();
  await item.click();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Raw document text, with source mode forced on so markers are visible. */
async function sourceText(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Source mode" }).click();
  return (await editorSurface(page).innerText()).replace(/ /g, " ");
}

async function setup(page: Page, prefix: string, content: string) {
  await signupFreshUser(page, prefix);
  await createNoteViaApi(page, "Menu fixture", content);
  await page.reload();
  await openNoteFromExplorer(page, "Menu fixture");
  await editorSurface(page).click();
}

test.describe("editor context menu", () => {
  test("lists every command group", async ({ page }) => {
    await setup(page, "ctxmenu-groups", "hello world\n");
    const menu = await openMenu(page);
    for (const group of [
      "Format",
      "Text colour",
      "Highlight colour",
      "Paragraph",
      "Lists",
      "Insert",
      "Callout",
      "Table",
      "Properties",
    ]) {
      await expect(menu.getByRole("menuitem", { name: group, exact: true })).toBeVisible();
    }
  });

  test("bold wraps the selection and unwrapping is idempotent", async ({ page }) => {
    await setup(page, "ctxmenu-bold", "hello world\n");
    await page.keyboard.press("ControlOrMeta+a");
    await choose(page, "Format", "Bold");
    expect(await sourceText(page)).toContain("**hello world**");

    // Re-running over the same (now marker-inclusive) selection must strip the
    // markers rather than produce ****hello world****.
    await page.getByRole("button", { name: "Live preview" }).click();
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await choose(page, "Format", "Bold");
    const text = await sourceText(page);
    expect(text).not.toContain("****");
  });

  test("italic inside bold does not demote the bold", async ({ page }) => {
    await setup(page, "ctxmenu-italic", "**strong**\n");
    // Select just the inner word, leaving the ** markers on either side.
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
    await choose(page, "Format", "Italic");
    expect(await sourceText(page)).toContain("**");
  });

  test("underline and colour use inline HTML", async ({ page }) => {
    await setup(page, "ctxmenu-html", "colour me\n");
    await page.keyboard.press("ControlOrMeta+a");
    await choose(page, "Format", "Underline");
    expect(await sourceText(page)).toContain("<u>colour me</u>");

    await page.getByRole("button", { name: "Live preview" }).click();
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await choose(page, "Text colour", "Red");
    expect(await sourceText(page)).toContain('<span style="color:#e93147">');
  });

  test("heading level is applied to the caret line", async ({ page }) => {
    await setup(page, "ctxmenu-heading", "a title\n");
    await choose(page, "Paragraph", "Heading 2");
    expect(await sourceText(page)).toContain("## a title");
  });

  test("insert table writes a GFM table and enables the table group", async ({ page }) => {
    await setup(page, "ctxmenu-table", "");
    await choose(page, "Insert", "Table");
    expect(await sourceText(page)).toContain("| Column 1 | Column 2 | Column 3 |");

    // The caret lands inside the new table, so the Table group must now be live.
    await page.getByRole("button", { name: "Live preview" }).click();
    const menu = await openMenu(page);
    const table = menu.getByRole("menuitem", { name: "Table", exact: true });
    await expect(table).not.toHaveAttribute("data-disabled", "");
  });

  test("table commands work by right-clicking the rendered table", async ({ page }) => {
    await setup(page, "ctxmenu-tableops", "| A | B |\n| --- | --- |\n| 1 | 2 |\n");

    // Live preview replaces the source with a rendered table widget. Right
    // clicking THAT must still reach the table commands — this is how a user
    // edits a table they can see.
    const widget = editorSurface(page).locator(".cm-table-widget");
    await expect(widget).toBeVisible();
    await widget.click({ button: "right" });
    let menu = page.getByRole("menu").first();
    await menu.getByRole("menuitem", { name: "Table", exact: true }).click();
    await page.getByRole("menu").last().getByRole("menuitem", { name: /^Insert row below/ }).click();

    let text = await sourceText(page);
    expect(text.split("\n").filter((l) => l.trim().startsWith("|")).length).toBe(4);

    await page.getByRole("button", { name: "Live preview" }).click();
    await editorSurface(page).locator(".cm-line").first().click({ button: "right" });
    menu = page.getByRole("menu").first();
    await menu.getByRole("menuitem", { name: "Table", exact: true }).click();
    await page.getByRole("menu").last().getByRole("menuitem", { name: /^Insert column right/ }).click();
    text = await sourceText(page);
    expect(text).toContain("New column");
  });

  test("sort lines is enabled only with a selection and reorders it", async ({ page }) => {
    await setup(page, "ctxmenu-sort", "cherry\napple\nbanana\n");

    // No selection → the group is inert.
    const menu = await openMenu(page);
    await expect(menu.getByRole("menuitem", { name: /Sort & filter lines/ })).toHaveAttribute(
      "data-disabled",
      "",
    );
    await page.keyboard.press("Escape");

    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await choose(page, "Sort & filter lines", "Sort A → Z");
    const text = await sourceText(page);
    expect(text.indexOf("apple")).toBeLessThan(text.indexOf("banana"));
    expect(text.indexOf("banana")).toBeLessThan(text.indexOf("cherry"));
  });

  test("checkmarks report the formatting under the caret", async ({ page }) => {
    await setup(
      page,
      "ctxmenu-active",
      ["## A heading", "", "Some **bold words** here.", "", "- a bullet", ""].join("\n"),
    );

    // Heading line → Heading 2 checked, the rest not.
    const menu = await openMenu(page, 0);
    await menu.getByRole("menuitem", { name: "Paragraph", exact: true }).click();
    let sub = page.getByRole("menu").last();
    await expect(sub.getByRole("menuitemcheckbox", { name: /^Heading 2/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(sub.getByRole("menuitemcheckbox", { name: /^Heading 1/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Caret inside **bold words** → Bold checked. The caret lands BETWEEN the
    // markers, which a marker-matching check would report as unformatted.
    await editorSurface(page).getByText("bold words").click({ button: "right" });
    const menu2 = page.getByRole("menu").first();
    await expect(menu2).toBeVisible();
    await menu2.getByRole("menuitem", { name: "Format", exact: true }).click();
    sub = page.getByRole("menu").last();
    await expect(sub.getByRole("menuitemcheckbox", { name: /^Bold/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(sub.getByRole("menuitemcheckbox", { name: /^Italic/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("bullet lines report the bullet list as active", async ({ page }) => {
    await setup(page, "ctxmenu-active-list", ["- first", "- second", ""].join("\n"));
    const menu = await openMenu(page, 0);
    await menu.getByRole("menuitem", { name: "Lists", exact: true }).click();
    const sub = page.getByRole("menu").last();
    await expect(sub.getByRole("menuitemcheckbox", { name: "Bullet list" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(sub.getByRole("menuitemcheckbox", { name: "Numbered list" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });


  test("the Table group is reachable in prose and inserts without eating a selection", async ({
    page,
  }) => {
    await setup(page, "ctxmenu-tablegroup", "keep me\n");

    // Select the line, then insert a table from the group people actually look
    // in. The group used to be disabled outright here.
    await editorSurface(page).locator(".cm-line").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");

    const menu = await openMenu(page, 0);
    const table = menu.getByRole("menuitem", { name: "Table", exact: true });
    await expect(table).not.toHaveAttribute("data-disabled", "");
    await table.click();

    const sub = page.getByRole("menu").last();
    await expect(sub.getByRole("menuitem", { name: "Insert table" })).not.toHaveAttribute(
      "data-disabled",
      "",
    );
    // The row operations stay off until there IS a table.
    await expect(sub.getByRole("menuitem", { name: "Insert row above" })).toHaveAttribute(
      "data-disabled",
      "",
    );
    await sub.getByRole("menuitem", { name: "Insert table" }).click();

    const text = await sourceText(page);
    expect(text).toContain("| Column 1 | Column 2 | Column 3 |");
    expect(text).toContain("keep me"); // the selection survived
  });

  test("table commands ignore prose that merely contains pipes", async ({ page }) => {
    // "a | b" is not a table: no delimiter row. Rewriting it would be
    // destructive, so the operations must stay disabled.
    await setup(page, "ctxmenu-pipes", "cost | benefit | verdict\n");
    const menu = await openMenu(page, 0);
    await menu.getByRole("menuitem", { name: "Table", exact: true }).click();
    await expect(
      page.getByRole("menu").last().getByRole("menuitem", { name: "Delete row" }),
    ).toHaveAttribute("data-disabled", "");
  });

  test("add file property creates frontmatter", async ({ page }) => {
    await setup(page, "ctxmenu-props", "body text\n");
    await choose(page, "Properties", "Add file property");
    const text = await sourceText(page);
    expect(text.startsWith("---")).toBe(true);
    expect(text).toContain("key: value");
  });
});
