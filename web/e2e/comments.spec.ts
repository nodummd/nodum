import { expect, test } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("%%comments%%", () => {
  test("visible-but-faint in live preview, stripped in reading view", async ({ page }) => {
    await signupFreshUser(page, "comments-e2e");

    await createNoteViaApi(
      page,
      "Commented note",
      "Before text %%secret aside%% after text.",
    );
    await page.reload();
    await openNoteFromExplorer(page, "Commented note");

    // Live preview: the comment stays visible, styled faint
    await expect(editorSurface(page)).toContainText("secret aside");
    await expect(page.locator(".cm-comment").first()).toBeVisible();

    // Reading view: the comment is gone, surrounding text intact
    await page.getByRole("button", { name: "Reading view" }).click();
    await expect(page.locator(".nodum-reading")).toContainText("Before text");
    await expect(page.locator(".nodum-reading")).toContainText("after text.");
    await expect(page.locator(".nodum-reading")).not.toContainText("secret aside");
  });
});
