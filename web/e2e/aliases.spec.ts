import { expect, test } from "@playwright/test";

import { createNoteViaApi, signupFreshUser } from "./helpers";

test.describe("aliases", () => {
  test("quick switcher finds a note by its frontmatter alias", async ({ page }) => {
    await signupFreshUser(page, "alias-e2e");

    await createNoteViaApi(
      page,
      "Project Phoenix",
      "---\naliases:\n  - Codename Rising\n---\nThe secret plan.",
    );
    await page.reload();
    await expect(page.getByText("Project Phoenix", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("ControlOrMeta+o");
    await page.getByPlaceholder("Find or create a note…").fill("Codename Ri");

    const aliasRow = page.getByText("↳ alias of Project Phoenix");
    await expect(aliasRow).toBeVisible({ timeout: 10_000 });

    // Selecting the alias row opens the canonical note
    await page.getByPlaceholder("Find or create a note…").press("Enter");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
      "Project Phoenix",
      { timeout: 10_000 },
    );
  });
});
