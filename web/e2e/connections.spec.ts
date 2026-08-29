import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/**
 * The Connections settings tab.
 *
 * These run against a server with no Google OAuth client configured, which is
 * the honest default and also the state every self-hoster starts in — so the
 * most valuable thing to assert is that the *unconfigured* path explains
 * itself rather than showing a Connect button that leads nowhere.
 *
 * The consent flow itself cannot be exercised without a registered Google
 * client and a real account, so it is not faked here: a test that stubs
 * Google's redirect would assert our own mock, not our behaviour.
 */

async function openConnections(page: import("@playwright/test").Page) {
  await page.keyboard.press("ControlOrMeta+Comma");
  const dialog = page.getByRole("dialog").filter({ hasText: "Settings" }).first();
  await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Connections", exact: true }).click();
  return dialog;
}

test.describe("connections", () => {
  test("explains itself when Google sync is not configured", async ({ page }) => {
    await signupFreshUser(page, "connections-ui");
    const dialog = await openConnections(page);

    // The promise the feature makes about the user's own writing has to be on
    // screen before anyone connects anything, not buried in docs.
    await expect(dialog.getByText(/only ever reads/i)).toBeVisible();
    await expect(dialog.getByText("## Notes")).toBeVisible();

    // Unconfigured is the default state; it must name the fix, including the
    // step that otherwise breaks every connection after seven days.
    await expect(dialog.getByText(/not configured on this server/i)).toBeVisible();
    await expect(dialog.getByText(/GOOGLE_SYNC_CLIENT_ID/)).toBeVisible();
    await expect(dialog.getByText(/Testing.*7 days|7 days/i)).toBeVisible();

    // And with no client configured there is nothing to click.
    await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  });

  test("the provider catalogue is honest about the Gmail restriction", async ({ page }) => {
    await signupFreshUser(page, "connections-api");

    const payload = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const res = await fetch("/api/v1/connections/providers", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    });

    const providers = payload.data.providers as {
      id: string;
      available: boolean;
      self_hosted_only: boolean;
      scopes: string[];
      caveats: string[];
    }[];
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

    // Calendar's scopes are sensitive, so it is offered everywhere...
    expect(byId["google_calendar"].self_hosted_only).toBe(false);
    expect(byId["google_calendar"].scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events.readonly",
    );
    // ...and never the broader calendar.readonly.
    expect(byId["google_calendar"].scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );

    // Gmail's are restricted: off unless an operator turns it on.
    expect(byId["google_gmail"].self_hosted_only).toBe(true);
    expect(byId["google_gmail"].available).toBe(false);
    for (const provider of providers) {
      expect(provider.caveats.length).toBeGreaterThan(0);
    }
  });

  test("a disabled provider cannot be started through the API", async ({ page }) => {
    await signupFreshUser(page, "connections-guard");

    const result = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const vaults = await (
        await fetch("/api/v1/vaults", { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      const res = await fetch(
        `/api/v1/connections/google/start?vault_id=${vaults.data[0].id}&provider=google_gmail`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      return { status: res.status, body: await res.text() };
    });

    // The UI hides it, but the endpoint must refuse it too — a gate that only
    // exists in the client is not a gate.
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body).not.toContain("accounts.google.com");
  });

  test("connections are scoped to their owner", async ({ page }) => {
    await signupFreshUser(page, "connections-owner");

    const listed = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const res = await fetch("/api/v1/connections/connections", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    });
    expect(Array.isArray(listed.data)).toBe(true);
    expect(listed.data).toHaveLength(0);

    // Unauthenticated access is refused outright.
    const anon = await page.evaluate(async () => {
      const res = await fetch("/api/v1/connections/connections", {
        headers: { Authorization: "Bearer not-a-token" },
      });
      return res.status;
    });
    expect(anon).toBeGreaterThanOrEqual(401);
  });
});
