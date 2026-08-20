import { expect, test } from "@playwright/test";

import { createNoteViaApi, signupFreshUser } from "./helpers";

test.describe("whole-vault publishing", () => {
  test("published site serves nav + notes; wikilinks navigate; unpublish hides", async ({
    page,
  }) => {
    await signupFreshUser(page, "vaultsite");
    await createNoteViaApi(page, "Guide", "Read the [[Extras]] page too.");
    await createNoteViaApi(page, "Extras", "Extra content here.");
    await createNoteViaApi(page, "Hidden", "---\npublish: false\n---\nNot public.");

    const slug = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const vaults = await (
        await fetch("/api/v1/vaults", { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      const pub = await (
        await fetch(`/api/v1/vaults/${vaults.data[0].id}/publish-site`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      return pub.data.slug as string;
    });

    // Anonymous read
    await page.context().clearCookies();
    await page.goto(`/s/${slug}`);
    await expect(page.getByText(/A published Nodum vault/)).toBeVisible({ timeout: 15_000 });
    const nav = page.getByRole("navigation");
    await expect(nav.getByText("Guide")).toBeVisible();
    await expect(nav.getByText("Hidden")).toHaveCount(0);

    await nav.getByText("Guide").click();
    await expect(page.getByRole("heading", { name: "Guide" })).toBeVisible({ timeout: 10_000 });

    // Wikilink inside the note navigates within the site
    await page.getByRole("main").getByText("Extras", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Extras" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Extra content here.")).toBeVisible();

    // publish:false note is not reachable
    await page.goto(`/s/${slug}/Hidden`);
    await expect(page.getByText(/part of the published site/)).toBeVisible({ timeout: 10_000 });

    // ── The crawler's view ────────────────────────────────────────────
    // These pages fetched their content in the browser once, which meant the
    // HTML a search engine or a link unfurler received said "Loading…" and
    // nothing else. Read the raw response, with no JavaScript, and assert the
    // note is actually in it.
    const raw = await page.request.get(`/s/${slug}/Guide`);
    const html = await raw.text();
    expect(html).toContain("Read the ");
    expect(html).toContain("<h1");
    expect(html).toContain("Guide");
    // A per-note title and description, not the site's generic blurb.
    expect(html).toMatch(/<title>Guide[^<]*<\/title>/);
    expect(html).toContain(`<link rel="canonical" href="`);
    // Published sites are indexable: publishing a vault is an explicit "this
    // is public", unlike the unlisted /p/ token links.
    expect(html).not.toMatch(/<meta name="robots" content="noindex/);
    // Article structured data, so the note can be understood as a document.
    expect(html).toContain('"@type":"Article"');
    // The whole nav is server-rendered too, so one crawled note reaches all.
    expect(html).toContain("Extras");

    const sitemap = await page.request.get(`/s/${slug}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain("<urlset");
    expect(xml).toContain(`/s/${slug}/Guide`);
    // A note excluded with `publish: false` must not be advertised either.
    expect(xml).not.toContain("Hidden");
  });
});
