import { expect, test } from "@playwright/test";

/** Host-based sections: docs./developers./community./forum. serve their
 *  section at the root of the subdomain, cross-section paths bounce to the
 *  right host, and the apex keeps serving everything while the redirect
 *  flag is off (as in dev). Browsers resolve *.localhost natively; the
 *  request-fixture cases override the Host header to skip OS DNS. */

// CI serves on 127.0.0.1 — an IP cannot take subdomains, localhost can.
const APEX = new URL(process.env.BASE_URL ?? "http://localhost:3000").host.replace("127.0.0.1", "localhost");

test.describe("host-based sections", () => {
  test("each subdomain serves its section from its root", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`http://docs.${APEX}/`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("What every part of Nodum is for");
    await page.goto(`http://docs.${APEX}/mcp`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("MCP");

    await page.goto(`http://forum.${APEX}/`);
    await expect(page.getByRole("heading", { name: "Talk Nodum" })).toBeVisible();

    await page.goto(`http://community.${APEX}/`);
    await expect(page.getByRole("heading", { name: "Built in the open" })).toBeVisible();

    await page.goto(`http://developers.${APEX}/`);
    await expect(page.getByRole("heading", { name: "Nodum API" })).toBeVisible({ timeout: 20_000 });
  });

  test("prefixed and cross-section paths land on their proper hosts", async ({ request }) => {
    const base = `http://${APEX}`;
    // A section's own prefix canonicalizes to the root form.
    const prefixed = await request.get(`${base}/docs/mcp`, {
      headers: { Host: `docs.${APEX}` },
      maxRedirects: 0,
    });
    expect(prefixed.status()).toBe(308);
    expect(prefixed.headers()["location"]).toContain(`docs.${APEX}/mcp`);

    // Another section's path 307s to that section's host, rooted.
    const stray = await request.get(`${base}/docs/mcp`, {
      headers: { Host: `forum.${APEX}` },
      maxRedirects: 0,
    });
    expect(stray.status()).toBe(307);
    expect(stray.headers()["location"]).toContain(`docs.${APEX}/mcp`);
    expect(stray.headers()["location"]).not.toContain("forum.");

    // App-shell paths pass through untouched on any host.
    const login = await request.get(`${base}/login`, {
      headers: { Host: `docs.${APEX}` },
      maxRedirects: 0,
    });
    expect(login.status()).toBe(200);

    // The apex is untouched while the redirect flag is off.
    const apex = await request.get(`${base}/docs`, { maxRedirects: 0 });
    expect(apex.status()).toBe(200);
    const apexRef = await request.get(`${base}/api-reference`, { maxRedirects: 0 });
    expect(apexRef.status()).toBe(200);
  });

  test("apex-only pages leave a section host instead of 404ing there", async ({ request }) => {
    // The footer's Compare/Learn links are on every host. Off localhost the
    // section host 308s them to the apex; the host here is not this server's
    // own origin, so the Location stays absolute.
    const moved = await request.get(`http://${APEX}/alternatives/obsidian`, {
      headers: { Host: "forum.nodum.test" },
      maxRedirects: 0,
    });
    expect(moved.status()).toBe(308);
    expect(moved.headers()["location"]).toMatch(/^https?:\/\/nodum\.test\/alternatives\/obsidian$/);

    // On localhost the apex IS this origin — a redirect would be relativized
    // into a loop — so the page is served in place, canonical on the apex.
    const inPlace = await request.get(`http://${APEX}/learn`, {
      headers: { Host: `forum.${APEX}` },
      maxRedirects: 0,
    });
    expect(inPlace.status()).toBe(200);
    const canonical = (await inPlace.text()).match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(new URL(canonical as string).pathname).toBe("/learn");
  });

  test("www redirects to the canonical host", async ({ request }) => {
    const res = await request.get(`http://${APEX}/alternatives?x=1`, {
      headers: { Host: "www.nodum.md" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("https://nodum.md/alternatives?x=1");
  });

  test("the navbar's Developers link reaches the API reference", async ({ page, request }) => {
    // Apex install: the link serves the reference in place.
    await page.goto("/");
    await page.getByRole("link", { name: "Developers", exact: true }).click();
    await expect(page).toHaveURL(/\/api-reference/);
    await expect(page.getByRole("heading", { name: "Nodum API" })).toBeVisible({ timeout: 20_000 });

    // On a section host the same path canonicalizes onto developers.<domain>.
    const hop = await request.get(`http://${APEX}/api-reference`, {
      headers: { Host: `developers.${APEX}` },
      maxRedirects: 0,
    });
    expect(hop.status()).toBe(308);
    expect(hop.headers()["location"]).toContain(`developers.${APEX}/`);
  });
});
