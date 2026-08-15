import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/**
 * Every formatting command the right-click menu offers, driven through the menu
 * and asserted against the RAW markdown. Live preview hides the very markers
 * these commands write, so asserting on rendered text would pass on a no-op.
 */

async function source(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Source mode" }).click();
  const text = await editorSurface(page).innerText();
  await page.getByRole("button", { name: "Live preview" }).click();
  return text;
}

/** group → command, run against a one-line note seeded with `seed`. */
const CASES: {
  group: string;
  cmd: string;
  seed: string;
  selectLine: boolean;
  expected: RegExp;
}[] = [
  { group: "Format", cmd: "Strikethrough", seed: "gone", selectLine: true, expected: /~~gone~~/ },
  { group: "Format", cmd: "Highlight", seed: "mark", selectLine: true, expected: /==mark==/ },
  { group: "Format", cmd: "Inline code", seed: "code", selectLine: true, expected: /`code`/ },
  { group: "Format", cmd: "Code block", seed: "body", selectLine: false, expected: /```/ },
  { group: "Insert", cmd: "Link", seed: "text", selectLine: true, expected: /\[text\]\(\)/ },
  { group: "Insert", cmd: "Horizontal rule", seed: "x", selectLine: false, expected: /^---$/m },
  { group: "Lists", cmd: "Bullet list", seed: "item", selectLine: false, expected: /- item/ },
  { group: "Lists", cmd: "Numbered list", seed: "one", selectLine: false, expected: /1\. one/ },
  { group: "Lists", cmd: "Task list", seed: "todo", selectLine: false, expected: /- \[ \] todo/ },
  { group: "Lists", cmd: "Blockquote", seed: "quoted", selectLine: false, expected: /> quoted/ },
  { group: "Callout", cmd: "note", seed: "warn", selectLine: false, expected: /> \[!note\]/ },
];

test.describe("editor formatting commands", () => {
  for (const c of CASES) {
    test(`${c.group} → ${c.cmd} edits the document`, async ({ page }) => {
      await signupFreshUser(page, "cmd");
      await createNoteViaApi(page, "Command note", `${c.seed}\n`);
      await page.reload();
      await openNoteFromExplorer(page, "Command note");

      await editorSurface(page).locator(".cm-line").first().click();
      if (c.selectLine) {
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
      }

      await editorSurface(page).locator(".cm-line").first().click({ button: "right" });
      await page.getByRole("menu").first().getByRole("menuitem", { name: c.group, exact: true }).click();
      await page
        .getByRole("menu")
        .last()
        .locator('[role="menuitem"], [role="menuitemcheckbox"]')
        .filter({ hasText: new RegExp(`^${c.cmd}`, "i") })
        .first()
        .click();

      expect(await source(page)).toMatch(c.expected);
    });
  }

  test("select all really selects the document", async ({ page }) => {
    await signupFreshUser(page, "cmd-selectall");
    await createNoteViaApi(page, "Sel note", "alpha bravo\n");
    await page.reload();
    await openNoteFromExplorer(page, "Sel note");

    await editorSurface(page).locator(".cm-line").first().click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: /^Select all/ }).click();

    // drawSelection() paints CodeMirror's own selection layer, leaving the
    // NATIVE selection empty — prove the selection exists by acting on it.
    await editorSurface(page).locator(".cm-line").first().click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Format", exact: true }).click();
    await page
      .getByRole("menu")
      .last()
      .locator('[role="menuitemcheckbox"]')
      .filter({ hasText: /^Bold/ })
      .click();

    await page.getByRole("button", { name: "Source mode" }).click();
    expect(await editorSurface(page).innerText()).toContain("**alpha bravo**");
  });
});
