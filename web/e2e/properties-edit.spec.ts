import { expect, test } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("editable properties widget", () => {
  test("editing card fields rewrites the YAML frontmatter", async ({ page }) => {
    await signupFreshUser(page, "props-edit");

    const content = [
      "---",
      "status: active",
      "done: false",
      "topics:",
      "  - alpha",
      "  - beta",
      "---",
      "",
      "Body text stays put.",
    ].join("\n");
    await createNoteViaApi(page, "Props note", content);
    await page.reload();
    await openNoteFromExplorer(page, "Props note");

    // Cursor at doc end → properties card renders
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+ArrowDown");
    await expect(page.locator(".cm-properties-widget")).toBeVisible({ timeout: 10_000 });

    // Scalar edit commits on Enter
    const status = page.getByLabel("status value");
    await status.fill("archived");
    await status.press("Enter");
    await expect(page.getByLabel("status value")).toHaveValue("archived", { timeout: 10_000 });

    // Boolean toggle commits immediately
    await page.getByLabel("done value").check();
    await expect(page.getByLabel("done value")).toBeChecked({ timeout: 10_000 });

    // List pill removal
    await page.getByRole("button", { name: "Remove alpha from topics" }).click();
    await expect(page.getByRole("button", { name: "Remove alpha from topics" })).not.toBeVisible({
      timeout: 10_000,
    });

    // Source of truth: raw YAML updated (check via source mode reveal)
    await page.getByRole("button", { name: "Source mode" }).click();
    await expect(editorSurface(page)).toContainText("status: archived");
    await expect(editorSurface(page)).toContainText("done: true");
    await expect(editorSurface(page)).not.toContainText("- alpha");
    await expect(editorSurface(page)).toContainText("- beta");
    await expect(editorSurface(page)).toContainText("Body text stays put.");
  });
});
