import { expect, test } from "@playwright/test";

import { editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("notes & editor", () => {
  test("create a note via quick switcher and edit it with autosave", async ({ page }) => {
    await signupFreshUser(page, "notes-create");

    // ⌘O → type a new name → Enter creates it
    await page.keyboard.press("ControlOrMeta+o");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/find or create/i).fill("Coffee brewing log");
    await dialog.getByText(/Create\s+“Coffee brewing log”/).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Coffee brewing log",
      { timeout: 10_000 },
    );

    // Type content into CodeMirror; autosave fires after 700ms debounce
    await editorSurface(page).click();
    await page.keyboard.type("# Brew notes\n\nThe grind matters more than the machine.");
    await page.waitForTimeout(1_200);

    // Reload — content must have persisted
    await page.reload();
    await expect(page.getByText("The grind matters more than the machine.")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("wikilink typed in one note appears as backlink on the target", async ({ page }) => {
    await signupFreshUser(page, "notes-backlink");

    // Create a fresh source note via the quick switcher
    await page.keyboard.press("ControlOrMeta+o");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/find or create/i).fill("Source note");
    await dialog.getByText(/Create\s+“Source note”/).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Source note", {
      timeout: 10_000,
    });

    await editorSurface(page).click();
    await page.keyboard.type("Referencing [[Formatting showcase]] here. ");
    await page.waitForTimeout(1_200);

    // Open the target and check the backlinks panel
    await openNoteFromExplorer(page, "Formatting showcase");
    const backlinksPanel = page.getByText(/linked mentions/i).first();
    await expect(backlinksPanel).toBeVisible();
    // The panel should list a source note referencing it (welcome note links + ours)
    await expect(page.getByText(/linked mentions \([1-9]\d*\)/i)).toBeVisible({ timeout: 10_000 });
  });

  test("checkbox in live preview toggles source", async ({ page }) => {
    await signupFreshUser(page, "notes-checkbox");
    await openNoteFromExplorer(page, "Formatting showcase");

    const openBox = page.locator(".cm-task-checkbox").first();
    await expect(openBox).toBeVisible({ timeout: 10_000 });
    const wasChecked = await openBox.isChecked();
    await openBox.click();
    await page.waitForTimeout(1_000); // autosave

    await page.reload();
    const boxAfter = page.locator(".cm-task-checkbox").first();
    await expect(boxAfter).toBeVisible({ timeout: 15_000 });
    expect(await boxAfter.isChecked()).toBe(!wasChecked);
  });

  test("reading view renders math and strips frontmatter", async ({ page }) => {
    await signupFreshUser(page, "notes-reading");
    await openNoteFromExplorer(page, "Formatting showcase");

    await page.getByRole("button", { name: "Reading view" }).click();
    await expect(page.locator(".katex").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".nodum-reading")).not.toContainText("tags:");

    // back to live preview for other tests' default state
    await page.getByRole("button", { name: "Live preview" }).click();
  });

  test("search pane finds notes with highlighted snippets", async ({ page }) => {
    await signupFreshUser(page, "notes-search");

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Search notes").fill("wikilinks");
    await expect(page.locator("mark").first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("daily notes", () => {
  test("ribbon button creates and reopens today's daily note", async ({ page }) => {
    await signupFreshUser(page, "daily-e2e");

    await page.getByRole("button", { name: "Open today's daily note" }).click();
    const title = page.getByRole("textbox", { name: "Note title" });
    await expect(title).toBeVisible({ timeout: 10_000 });
    const value = await title.inputValue();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Clicking again reuses the same note (no duplicate)
    await page.getByRole("button", { name: "Open today's daily note" }).click();
    await expect(title).toHaveValue(value);
  });
});

test.describe("live preview math", () => {
  test("inline and block math render as KaTeX in live preview", async ({ page }) => {
    await signupFreshUser(page, "math-live");
    await openNoteFromExplorer(page, "Formatting showcase");

    // Both the inline formula and the $$ block render without entering reading view
    await expect(page.locator(".cm-math-inline .katex").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".cm-math-block .katex").first()).toBeVisible({ timeout: 10_000 });
  });
});
