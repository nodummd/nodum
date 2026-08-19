import { expect, test } from "@playwright/test";

import { createNoteViaApi, signupFreshUser } from "./helpers";

test.describe("nested tag pane", () => {
  test("renders the a/b hierarchy, collapses, and click seeds tag: search", async ({ page }) => {
    await signupFreshUser(page, "tagtree");
    await createNoteViaApi(
      page,
      "Tagged note",
      "Work items #project/alpha and #project/beta live here.",
    );
    await page.reload();

    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await expect(page.getByText("#project", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("#alpha", { exact: true })).toBeVisible();
    await expect(page.getByText("#beta", { exact: true })).toBeVisible();

    // Collapse hides the children, expand restores them
    await page.getByRole("button", { name: "Collapse project" }).click();
    await expect(page.getByText("#alpha", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Expand project" }).click();
    await expect(page.getByText("#alpha", { exact: true })).toBeVisible();

    // Clicking a nested tag opens the search pane seeded with tag:
    await page.getByText("#alpha", { exact: true }).click();
    await expect(page.getByLabel("Search notes")).toHaveValue("tag:#project/alpha", {
      timeout: 10_000,
    });
    await expect(page.getByText("Tagged note").first()).toBeVisible({ timeout: 10_000 });
  });
});
