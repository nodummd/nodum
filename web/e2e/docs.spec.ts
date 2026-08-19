import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** The documentation: public, navigable, searchable, and every article's
 *  screenshot really exists. Plus the ways into it from the app. */

test.describe("documentation", () => {
  test("the index lists every article and each one renders with its pictures", async ({ page, request }) => {
    await page.goto("/docs");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("What every part of Nodum is for");
    const links = page.locator(".mk-docs-index-card");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(18);

    // Every article: opens, has a heading, and its images are real files.
    const hrefs = await links.evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute("href")));
    for (const href of hrefs) {
      await page.goto(href!);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const images = await page.locator(".mk-docs-figure img").evaluateAll((els) =>
        els.map((el) => (el as HTMLImageElement).getAttribute("src")),
      );
      for (const src of images) {
        const res = await request.get(src!);
        expect(res.status(), `${href} → ${src}`).toBe(200);
      }
    }
  });

  test("the rail filters as you type, and the current article is marked", async ({ page }) => {
    await page.goto("/docs/graph");
    const rail = page.getByRole("navigation", { name: "Documentation" });
    await expect(rail.getByRole("link", { name: "Graph view" })).toHaveAttribute("aria-current", "page");
    await rail.getByRole("searchbox").fill("backlink");
    await expect(rail.getByRole("link", { name: "Links and backlinks" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Canvas" })).toHaveCount(0);
    await rail.getByRole("searchbox").fill("zzzz-nothing");
    await expect(rail.getByText(/Nothing matches/)).toBeVisible();

    // Full text: a phrase that appears only in an article's body finds the
    // article, and the row shows the sentence it was found in.
    await rail.getByRole("searchbox").fill("mcp-remote");
    await expect(rail.getByRole("link", { name: "MCP" })).toBeVisible();
    await expect(rail.getByTestId("docs-snippet").first()).toContainText(/mcp-remote/);
    await expect(rail.getByRole("link", { name: "Canvas" })).toHaveCount(0);
  });

  test("Help in the ribbon opens the docs in a new tab", async ({ page }) => {
    await signupFreshUser(page, "docs-help");
    await page.getByRole("button", { name: "Help" }).click();
    const opened = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "Documentation" }).click();
    const docs = await opened;
    await expect(docs).toHaveURL(/\/docs$/);
    await expect(docs.getByRole("heading", { level: 1 })).toContainText("What every part of Nodum is for");
    await docs.close();
  });
});
