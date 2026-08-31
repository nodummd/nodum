import { expect, test } from "@playwright/test";

import { createNoteViaApi, openNoteFromExplorer, signupFreshUser } from "./helpers";

/**
 * Note content is not always written by the person reading it.
 *
 * A connected mailbox or calendar puts text from anyone who can reach you into
 * your vault — a display name, a subject, an agenda, and with bodies switched
 * on, whole messages converted from HTML. The renderer is what stands between
 * that and the browser.
 *
 * It holds today: `react-markdown` runs without `rehype-raw`, so raw HTML is
 * lowered to text, and only five tags nodum emits itself are rebuilt. But that
 * is a property nothing was asserting — one plugin away from being wrong, in a
 * pipeline nobody would think to re-audit. These pin it, in the browser, where
 * the answer actually is.
 */

const HOSTILE = [
  '<img src=x onerror="window.__pwned = 1">',
  "<script>window.__pwned = 1</script>",
  '<a href="javascript:window.__pwned=1">a link</a>',
  "[a markdown link](javascript:window.__pwned=1)",
  '<iframe src="javascript:window.__pwned=1"></iframe>',
  "<svg/onload=window.__pwned=1>",
  '<div onmouseover="window.__pwned=1">hover me</div>',
].join("\n\n");

test.describe("content that arrived from someone else", () => {
  test("cannot run script in the reading view", async ({ page }) => {
    await signupFreshUser(page, "synced-safety");
    await createNoteViaApi(page, "From a stranger", `# Meeting\n\n${HOSTILE}\n`);
    await page.reload();
    await openNoteFromExplorer(page, "From a stranger");

    await page.getByRole("button", { name: "Reading view" }).click();
    const reading = page.locator(".nodum-reading");
    await expect(reading).toContainText("Meeting");

    // Nothing ran, and nothing became a real element that could later run.
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(reading.locator("script")).toHaveCount(0);
    await expect(reading.locator("iframe")).toHaveCount(0);
    await expect(reading.locator("svg")).toHaveCount(0);
    await expect(reading.locator("[onerror], [onload], [onmouseover]")).toHaveCount(0);

    // A javascript: URL never survives as an href, whether it arrived as HTML
    // or as ordinary markdown.
    for (const href of await reading.locator("a").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    )) {
      expect(href.toLowerCase()).not.toContain("javascript:");
    }
  });

  test("the words are still shown, not silently swallowed", async ({ page }) => {
    await signupFreshUser(page, "synced-safety-text");
    await createNoteViaApi(page, "Still readable", "# Agenda\n\n<b>bring the deck</b>\n");
    await page.reload();
    await openNoteFromExplorer(page, "Still readable");

    await page.getByRole("button", { name: "Reading view" }).click();
    // Inert, but the sender's words are theirs and stay on screen.
    await expect(page.locator(".nodum-reading")).toContainText("bring the deck");
  });

  test("a published note serves the same inert content to anonymous readers", async ({
    page,
    context,
  }) => {
    await signupFreshUser(page, "synced-safety-public");
    await createNoteViaApi(page, "Public note", `# Public\n\n${HOSTILE}\n`);

    const token = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const bearer = (await refresh.json()).data.access_token;
      const headers = { Authorization: `Bearer ${bearer}` };
      const vaults = await (await fetch("/api/v1/vaults", { headers })).json();
      const vaultId = vaults.data[0].id;
      const tree = await (await fetch(`/api/v1/vaults/${vaultId}/tree`, { headers })).json();
      const note = (tree.data.items as { type: string; id: string; title: string }[]).find(
        (item) => item.title === "Public note",
      )!;
      const res = await fetch(`/api/v1/vaults/${vaultId}/notes/${note.id}/publish`, {
        method: "POST",
        headers,
      });
      return (await res.json()).data.token as string;
    });
    expect(token).toBeTruthy();

    // A reader who has never signed in — the audience with the least defence,
    // looking at content that came from someone else entirely.
    const anon = await context.browser()!.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(`/p/${token}`);
    // The note title and its own H1 both say "Public".
    await expect(visitor.getByRole("heading", { name: "Public" }).first()).toBeVisible({
      timeout: 15_000,
    });

    expect(await visitor.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    // Scoped to the rendered note: the page's own framework scripts are not
    // what this is about, and matching them would make the assertion useless.
    const article = visitor.locator(".nodum-reading");
    await expect(article.locator("script, iframe, svg")).toHaveCount(0);
    await expect(article.locator("[onerror], [onload], [onmouseover]")).toHaveCount(0);
    await anon.close();
  });
});
