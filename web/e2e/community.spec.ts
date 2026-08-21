import { expect, test, type Page } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** The community forum's public read surface: anonymous browsing, the
 *  crawler view, and — load-bearing — that a stranger's markdown renders
 *  inert: raw HTML as literal text, images as links, no script execution. */

async function apiCall(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const token = (await (await fetch("/api/v1/auth/refresh", { method: "POST" })).json()).data.access_token;
      const r = await fetch(`/api/v1${url}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text).data : null;
    },
    { method, url, body },
  );
}

test.describe("community", () => {
  test("anonymous browse, crawler view, and hostile markdown stays inert", async ({ page, request, context }) => {
    test.setTimeout(90_000);
    await signupFreshUser(page, "forum");
    const marker = `e2e${Date.now().toString(36)}`;
    const hostile = [
      `A post by ${marker}.`,
      "",
      "<script>window.__pwned = true</script>",
      "",
      "![tracking pixel](https://evil.example/pixel.png)",
      "",
      "[innocent looking](javascript:window.__pwned2=true)",
      "",
      "```",
      "code stays code",
      "```",
    ].join("\n");
    const topic = (await apiCall(page, "POST", "/community/topics", {
      category: "showcase",
      title: `Showcase ${marker}`,
      content: hostile,
    })) as { id: string; slug: string };
    await apiCall(page, "POST", `/community/topics/${topic.id}/posts`, { content: `Reply from ${marker}.` });

    // Anonymous from here on. The thread page renders fresh (never cached
    // before now); the list pages are allowed 30s of staleness by design.
    await context.clearCookies();
    await page.goto(`/community/t/${topic.id}/${topic.slug}`);
    await expect(page.getByRole("heading", { name: `Showcase ${marker}` })).toBeVisible();

    // The hostile bits render as text/links, never as behavior.
    await expect(page.getByText(`A post by ${marker}.`)).toBeVisible();
    await expect(page.getByText("<script>window.__pwned = true</script>")).toBeVisible();
    expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
    const pixel = page.getByRole("link", { name: "tracking pixel" });
    await expect(pixel).toBeVisible();
    expect(await page.locator("article img").count()).toBe(0);
    const badHref = await page.getByRole("link", { name: "innocent looking" }).getAttribute("href");
    expect(badHref ?? "").not.toContain("javascript:");
    await expect(page.getByText("code stays code")).toBeVisible();
    await expect(page.getByText(`Reply from ${marker}.`)).toBeVisible();

    // The crawler view: content, title and canonical in the raw HTML.
    const raw = await (await request.get(`/community/t/${topic.id}/${topic.slug}`)).text();
    expect(raw).toContain(`A post by ${marker}.`);
    expect(raw).toContain(`<title>Showcase ${marker}`);
    expect(raw).toContain(`/community/t/${topic.id}/${topic.slug}`);
    expect(raw).not.toContain("noindex");

    // Wrong slug 308s to canonical.
    const redirected = await request.get(`/community/t/${topic.id}/nonsense`, { maxRedirects: 0 });
    expect(redirected.status()).toBe(308);

    // The list pages catch up within their 30s revalidate window.
    await expect(async () => {
      await page.goto("/community/c/showcase");
      await expect(page.getByRole("link", { name: `Showcase ${marker}` })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 45_000 });
    await page.goto("/community");
    await expect(page.getByRole("heading", { name: "Talk Nodum" })).toBeVisible();
  });
});
