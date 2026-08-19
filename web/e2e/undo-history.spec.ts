import { expect, test } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/** Undo must survive leaving a note and coming back, and switching editor
 *  mode — the history lived in an EditorState that used to be thrown away. */

test.describe("undo history", () => {
  test("survives a tab switch, a mode switch, and a reading-view round trip; redo has a Windows chord", async ({
    page,
  }) => {
    await signupFreshUser(page, "undo-e2e");
    await createNoteViaApi(page, "First note", "alpha");
    await createNoteViaApi(page, "Second note", "beta");
    await page.reload();

    await openNoteFromExplorer(page, "First note");
    await editorSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" UNDOTEST");
    await expect(editorSurface(page)).toContainText("alpha UNDOTEST");
    // Let the autosave flush before leaving (so the draft and the server agree).
    await page.waitForTimeout(900);

    // Leave and come back.
    await openNoteFromExplorer(page, "Second note");
    await expect(editorSurface(page)).toContainText("beta");
    await openNoteFromExplorer(page, "First note");
    await expect(editorSurface(page)).toContainText("alpha UNDOTEST");
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorSurface(page)).not.toContainText("UNDOTEST");
    await expect(editorSurface(page)).toContainText("alpha");

    // Redo on the Windows chord as well as the platform one.
    await page.keyboard.press("Control+Shift+z");
    await expect(editorSurface(page)).toContainText("alpha UNDOTEST");

    // Source mode → back: a Compartment switch, history intact.
    await page.getByRole("button", { name: "Source mode" }).click();
    await page.getByRole("button", { name: "Live preview" }).click();
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorSurface(page)).not.toContainText("UNDOTEST");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(editorSurface(page)).toContainText("alpha UNDOTEST");

    // Reading view unmounts the editor entirely; the snapshot brings it back.
    await page.getByRole("button", { name: "Reading view" }).click();
    await expect(page.locator(".nodum-reading")).toContainText("alpha UNDOTEST");
    await page.getByRole("button", { name: "Live preview" }).click();
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorSurface(page)).not.toContainText("UNDOTEST");
    await expect(editorSurface(page)).toContainText("alpha");
  });
});
