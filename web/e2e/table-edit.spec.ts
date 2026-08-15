import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/** Editing a table in live preview: type in the cells, add and remove rows and
 *  columns, and never see the pipes unless you ask for Source mode. */

/** Click near a cell's right edge so the caret lands after its text.
 *  `End` is not usable here: on macOS it scrolls rather than moving the caret. */
async function clickAtEnd(page: Page, row: number, col: number) {
  const target = cell(page, row, col);
  const box = await target.boundingBox();
  if (!box) throw new Error(`cell ${row},${col} has no box`);
  await target.click({ position: { x: box.width - 3, y: box.height / 2 } });
}

const FIXTURE = ["| Name | Role |", "| --- | --- |", "| Ada | Maths |", "| Alan | Logic |", ""].join(
  "\n",
);

async function open(page: Page, prefix: string, content = FIXTURE) {
  await signupFreshUser(page, prefix);
  await createNoteViaApi(page, "Table note", content);
  await page.reload();
  await openNoteFromExplorer(page, "Table note");
  await expect(editorSurface(page).locator("[data-nodum-table]")).toBeVisible();
}

const cell = (page: Page, row: number, col: number) =>
  page.locator(`[data-table-cell][data-table-row="${row}"][data-table-col="${col}"]`);

async function source(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Source mode" }).click();
  const text = await editorSurface(page).innerText();
  await page.getByRole("button", { name: "Live preview" }).click();
  return text;
}

test.describe("editable tables", () => {
  test("renders a real grid with editable cells", async ({ page }) => {
    await open(page, "tbl-render");
    await expect(page.locator("[data-table-cell]")).toHaveCount(6);
    await expect(cell(page, 0, 0)).toHaveText("Name");
    await expect(cell(page, 2, 1)).toHaveText("Logic");
    await expect(cell(page, 1, 0)).toHaveAttribute("contenteditable", "true");
    // The markup is not on screen.
    await expect(editorSurface(page)).not.toContainText("| --- |");
  });

  test("typing lands in order and the caret survives every keystroke", async ({ page }) => {
    // THE canary. If the widget is recreated instead of updated, or the focused
    // cell is overwritten on echo, this reads "scitamehta" or just "s".
    await open(page, "tbl-type");
    await clickAtEnd(page, 1, 1);
    await page.keyboard.type("ematics", { delay: 30 });
    await expect(cell(page, 1, 1)).toHaveText("Mathsematics");
  });

  test("a cell edit changes only that cell in the source", async ({ page }) => {
    await open(page, "tbl-minimal");
    await clickAtEnd(page, 1, 0);
    await page.keyboard.type("X");
    // Byte-exact: a whole-table re-render would repad the other lines.
    expect(await source(page)).toContain("| AdaX | Maths |");
    expect(await source(page)).toContain("| Alan | Logic |");
  });

  test("clicking a cell does not reveal the raw markdown", async ({ page }) => {
    await open(page, "tbl-noreveal");
    await cell(page, 1, 1).click();
    await expect(page.locator("[data-nodum-table]")).toBeVisible();
    await expect(editorSurface(page)).not.toContainText("| --- |");
  });

  test("add row and add column grow the table", async ({ page }) => {
    await open(page, "tbl-grow");
    await cell(page, 1, 1).click();

    await page.getByRole("button", { name: "Add row" }).click();
    await expect(page.locator("[data-table-cell]")).toHaveCount(8);

    await page.getByRole("button", { name: "Add column" }).click();
    await expect(page.locator("[data-table-cell]")).toHaveCount(12);
    expect(await source(page)).toContain("New column");
  });

  test("add row while a cell has focus does not crash the view", async ({ page }) => {
    // The structural path replaces the tbody, which removes the focused cell
    // and fires focusout synchronously — inside EditorView.update, where a
    // dispatch throws. Without the re-entrancy guard this is a hard crash.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, "tbl-crash");
    await cell(page, 1, 0).click();
    await page.getByRole("button", { name: "Add row" }).click();
    await expect(page.locator("[data-table-cell]")).toHaveCount(8);
    expect(errors.filter((e) => /update are not allowed|updateState/i.test(e))).toEqual([]);
  });

  test("delete row and delete column shrink the table", async ({ page }) => {
    await open(page, "tbl-shrink");
    await cell(page, 2, 0).click();
    await page.getByRole("button", { name: "Delete row" }).click();
    await expect(page.locator("[data-table-cell]")).toHaveCount(4);

    await cell(page, 1, 1).click();
    await page.getByRole("button", { name: "Delete column" }).click();
    await expect(page.locator("[data-table-cell]")).toHaveCount(2);
  });

  test("Tab moves to the next cell", async ({ page }) => {
    await open(page, "tbl-tab");
    await cell(page, 1, 0).click();
    await page.keyboard.press("Tab");
    await expect(cell(page, 1, 1)).toBeFocused();
  });

  test("a pipe typed into a cell is escaped, not a new column", async ({ page }) => {
    await open(page, "tbl-pipe");
    await clickAtEnd(page, 1, 1);
    await page.keyboard.type(" | more");
    // Still two columns...
    await expect(page.locator("[data-table-cell]")).toHaveCount(6);
    // ...and the source escaped it.
    expect(await source(page)).toContain("\\|");
  });
});
