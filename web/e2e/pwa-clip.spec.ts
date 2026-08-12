import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

test.describe("PWA + web clipper", () => {
  test("manifest and service worker are served with a share target", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = await manifest.json();
    expect(body.share_target.action).toBe("/clip");
    expect(body.icons.length).toBeGreaterThanOrEqual(2);

    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(await sw.text()).toContain("nodum-shell");

    const icon = await request.get("/icon-192.png");
    expect(icon.ok()).toBe(true);
  });

  test("share-target params become a note in the Clippings folder", async ({ page }) => {
    await signupFreshUser(page, "clipper");

    await page.goto(
      "/clip?title=Read%20later&text=A%20great%20article&url=https%3A%2F%2Fexample.com%2Fpost",
    );
    await expect(page.getByLabel("Clip title")).toHaveValue("Read later");
    await expect(page.getByLabel("Clip content")).toHaveValue(/A great article/);
    await expect(page.getByLabel("Clip content")).toHaveValue(/Source: https:\/\/example\.com\/post/);

    await page.getByRole("button", { name: "Save to vault" }).click();
    await expect(page.getByText(/Saved .*Read later.* to Clippings/)).toBeVisible({
      timeout: 10_000,
    });

    // The note exists inside the Clippings folder
    const check = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const vaults = await (
        await fetch("/api/v1/vaults", { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      const note = await (
        await fetch(
          `/api/v1/vaults/${vaults.data[0].id}/notes/by-path?path=${encodeURIComponent("Clippings/Read later")}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
      ).json();
      return note.data?.content ?? "MISSING";
    });
    expect(check).toContain("Source: https://example.com/post");
  });
});
