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
  });
});
