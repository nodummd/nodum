import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("explorer sorting", () => {
  test("sort menu reorders notes by name and by modified time", async ({ page }) => {
    await signupFreshUser(page, "sort-e2e");

    const rowTitles = async () => {
      const rows = page.locator('[role="button"] span.truncate');
      return (await rows.allTextContents()).filter((t) => t.length > 0);
    };

    // Default: File name A→Z
    const alphabetical = await rowTitles();
    expect(alphabetical).toEqual([...alphabetical].sort((a, b) => a.localeCompare(b)));

    // Touch a note that isn't alphabetically last so modified-sort differs:
    // edit "Formatting showcase" (first alphabetically)
    await page.getByText("Formatting showcase", { exact: true }).first().click();
    await page.locator(".cm-content").first().click();
    await page.keyboard.type(" ");
    await page.waitForTimeout(1_200); // autosave

    await page.getByRole("button", { name: "Change sort order" }).click();
    await page.getByRole("menuitemradio", { name: "Modified time (new to old)" }).click();

    await expect(async () => {
      const titles = await rowTitles();
      expect(titles[0]).toBe("Formatting showcase");
    }).toPass({ timeout: 10_000 });

    // Back to A→Z for other tests
    await page.getByRole("button", { name: "Change sort order" }).click();
    await page.getByRole("menuitemradio", { name: "File name (A to Z)" }).click();
  });
});

test.describe("search filters", () => {
  test("sort select and date range constrain results", async ({ page }) => {
    await signupFreshUser(page, "searchfilter");

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Search notes").fill("nodum");
    await expect(page.locator("mark").first()).toBeVisible({ timeout: 10_000 });

    // Open filters, sort by title
    await page.getByRole("button", { name: "Search filters" }).click();
    await page.getByLabel("Sort results").selectOption("title");
    await expect(page.locator("mark").first()).toBeVisible({ timeout: 10_000 });

    // Date range in the future → zero results
    await page.getByLabel("From date").fill("2030-01-01");
    await expect(page.getByText("No results.")).toBeVisible({ timeout: 10_000 });

    // Clear the future date → results return
    await page.getByLabel("From date").fill("");
    await expect(page.locator("mark").first()).toBeVisible({ timeout: 10_000 });
  });
});
