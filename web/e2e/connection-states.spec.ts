import { expect, test, type Page } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/**
 * How a connection *reports itself*, rendered in a real browser.
 *
 * None of this had ever been seen on screen. A connection row only exists once
 * a real Google grant does, so every state below — the honest ones especially
 * — was reachable in tests only through the service that produces it, never
 * through the component that shows it.
 *
 * These stub the connections endpoint and let everything above it run for
 * real. That is not asserting a fake: the *shape* being stubbed is pinned
 * independently by the backend suite, which drives the same endpoint against a
 * real database. What is under test here is the half that suite cannot reach —
 * whether a connection that dropped records says so, whether the one message
 * that fixes a seven-day grant actually reaches the screen, and whether a
 * token can ever be rendered.
 */

type StubConnection = Record<string, unknown>;

function connection(overrides: StubConnection = {}): StubConnection {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    provider: "google_calendar",
    provider_name: "Google Calendar",
    vault_id: "VAULT",
    email: "tester@example.com",
    status: "active",
    error_class: "",
    last_error: "",
    connected_at: "2026-08-01T09:00:00+00:00",
    last_success_at: "2026-08-30T09:00:00+00:00",
    settings: {},
    last_run: { created: 3, updated: 1, unchanged: 12 },
    failed_records: 0,
    streams: [
      {
        stream: "calendar:events:primary",
        backfill_done: true,
        records_seen: 120,
        last_success_at: "2026-08-30T09:00:00+00:00",
        syncing: false,
      },
    ],
    ...overrides,
  };
}

async function openConnectionsWith(page: Page, rows: StubConnection[]) {
  const vaultId = new URL(page.url()).pathname.split("/")[2];
  await page.route("**/api/v1/connections/connections", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const data = rows.map((row) => ({ ...row, vault_id: vaultId }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  });

  // The connected list lives in the Import dialog now.
  await page.getByTestId("import-data-button").click();
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog.getByText("Live sync")).toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe("how a connection reports itself", () => {
  test("a healthy one says what the last run actually did", async ({ page }) => {
    await signupFreshUser(page, "conn-state-ok");
    const dialog = await openConnectionsWith(page, [connection()]);

    await expect(dialog.getByText("Up to date")).toBeVisible();
    // "Last run" would be a lie — the stats are only written when a run
    // finishes, so a failing connection would show counts from whenever it
    // last worked, presented as current.
    await expect(dialog.getByText(/Last successful run: 3 new, 1 updated, 12 unchanged\./)).toBeVisible();
    await expect(dialog.getByText("tester@example.com")).toBeVisible();
  });

  test("a run that dropped records never claims to be up to date", async ({ page }) => {
    await signupFreshUser(page, "conn-state-dropped");
    const dialog = await openConnectionsWith(page, [
      connection({ failed_records: 2, last_run: { created: 1, error: 2 } }),
    ]);

    // This is the reassuring lie the whole status design exists to prevent.
    await expect(dialog.getByText("Up to date")).toHaveCount(0);
    await expect(dialog.getByText("2 items could not be saved")).toBeVisible();
    await expect(dialog.getByText(/2 failed/)).toBeVisible();
  });

  test("one dropped record is singular", async ({ page }) => {
    await signupFreshUser(page, "conn-state-one");
    const dialog = await openConnectionsWith(page, [connection({ failed_records: 1 })]);
    await expect(dialog.getByText("1 item could not be saved")).toBeVisible();
  });

  test("a dead grant shows the message that actually fixes it", async ({ page }) => {
    await signupFreshUser(page, "conn-state-reauth");
    const testingMode =
      "Google expired this connection after 7 days, which it does for OAuth consent screens still " +
      'set to "Testing". In your Google Cloud project open APIs & Services → OAuth consent screen, ' +
      'press "Publish app" to move it to "In production", then connect again.';
    const dialog = await openConnectionsWith(page, [
      connection({ status: "needs_reauth", error_class: "oauth_testing_mode", last_error: testingMode }),
    ]);

    await expect(dialog.getByText("Disconnected by Google")).toBeVisible();
    // Generic "reconnect" advice here puts the user in a loop that breaks
    // again every seventh day, so the specific message has to be on screen.
    await expect(dialog.getByText(/Publish app/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Reconnect/ })).toBeVisible();
    // Nothing to sync a connection that cannot authenticate.
    await expect(dialog.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  });

  test("a first import shows a number that goes up, not a bar", async ({ page }) => {
    await signupFreshUser(page, "conn-state-backfill");
    const dialog = await openConnectionsWith(page, [
      connection({
        last_run: {},
        streams: [
          {
            stream: "calendar:events:primary",
            backfill_done: false,
            records_seen: 1240,
            last_success_at: null,
            syncing: true,
          },
        ],
      }),
    ]);

    // Neither Google API says how much history there is, so a percentage
    // would be invented.
    await expect(dialog.getByText(/Importing history…\s*1,240 so far/)).toBeVisible();
    await expect(dialog.getByText("%")).toHaveCount(0);
  });

  test("a server-side key problem is not blamed on the user", async ({ page }) => {
    await signupFreshUser(page, "conn-state-key");
    const dialog = await openConnectionsWith(page, [
      connection({
        status: "key_unavailable",
        error_class: "config",
        last_error: "Stored credentials could not be decrypted — the server's encryption key has changed.",
      }),
    ]);

    await expect(dialog.getByText("Server key unavailable")).toBeVisible();
    await expect(dialog.getByText(/encryption key has changed/)).toBeVisible();
    // Reconnect IS offered: a fresh consent issues fresh tokens under the new
    // key, which is exactly the remedy. The first version of this spec
    // asserted the button's absence on the theory that reconnecting cannot
    // fix an operator's key change — then a real key rotation happened on a
    // live instance, and reconnecting fixed it in one click.
    await expect(dialog.getByRole("button", { name: /Reconnect/ })).toBeVisible();
  });

  test("nothing a connection carries can put a token on screen", async ({ page }) => {
    await signupFreshUser(page, "conn-state-tokens");
    const dialog = await openConnectionsWith(page, [connection()]);
    await expect(dialog.getByText("Up to date")).toBeVisible();
    await expect(dialog.getByText("tester@example.com")).toBeVisible();

    const rendered = (await dialog.textContent()) ?? "";
    for (const secret of ["refresh", "ya29.", "ciphertext", "access_token"]) {
      expect(rendered.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
});

/**
 * The settings panel — what a connection actually syncs.
 *
 * Same reasoning as above: the panel only renders behind a real Google grant,
 * so it had never been opened in a browser. The request it *sends* is the part
 * worth pinning, because the server validates every value and refuses the
 * whole PATCH over one wrong type — a threshold sent as the string "3" is
 * rejected for a field the user never typed.
 */

const CALENDARS = [
  { id: "primary", summary: "Me", primary: true },
  { id: "team@example.com", summary: "Team", primary: false },
];

async function openPanel(page: Page, overrides: StubConnection = {}, calendars = CALENDARS, stale = false) {
  await page.route("**/api/v1/connections/connections/*/calendars", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { calendars, stale } }),
    });
  });

  const dialog = await openConnectionsWith(page, [
    connection({ settings: { available_calendars: calendars, calendar: { calendar_ids: ["primary"] } }, ...overrides }),
  ]);
  await dialog.getByRole("button", { name: "Options" }).click();
  await expect(dialog.getByTestId("sync-setup")).toBeVisible();
  return dialog;
}

test.describe("choosing what a connection syncs", () => {
  test("the picker lists the calendars Google reports, not just the stored ones", async ({ page }) => {
    await signupFreshUser(page, "panel-list");
    const dialog = await openPanel(page);

    await expect(dialog.getByText("Calendars to sync")).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /Me/ })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /Team/ })).not.toBeChecked();
  });

  test("saving sends a threshold the server will accept", async ({ page }) => {
    await signupFreshUser(page, "panel-save");
    const dialog = await openPanel(page);

    let sent: Record<string, unknown> = {};
    await page.route("**/api/v1/connections/connections/11111111-*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });

    await dialog.getByRole("checkbox", { name: /Team/ }).check();
    await dialog.getByLabel("Appearances before a person is linked").fill("5");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();

    // A number input hands back a string, and the server refuses the whole
    // PATCH over the type of a field the user never typed.
    expect(typeof sent.people_threshold).toBe("number");
    expect(sent.people_threshold).toBe(5);
    expect((sent.calendar as { calendar_ids: string[] }).calendar_ids).toEqual(["primary", "team@example.com"]);
  });

  test("a refusal from the server is shown, not swallowed", async ({ page }) => {
    await signupFreshUser(page, "panel-refused");
    const dialog = await openPanel(page);

    await page.route("**/api/v1/connections/connections/11111111-*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "validation_failed", message: "people_threshold must be between 1 and 1000." },
        }),
      });
    });

    await dialog.getByRole("button", { name: "Save" }).click();
    // The server names the field it refused; inventing our own wording here
    // is how the two drift until the form allows what the API rejects.
    await expect(page.getByText(/people_threshold must be between 1 and 1000\./)).toBeVisible();
  });

  test("a list that could not be refreshed says so rather than looking current", async ({ page }) => {
    await signupFreshUser(page, "panel-stale");
    const dialog = await openPanel(page, {}, CALENDARS, true);
    await expect(dialog.getByText(/may be out of date/)).toBeVisible();
  });

  test("Gmail-only controls do not appear on a calendar connection", async ({ page }) => {
    await signupFreshUser(page, "panel-scope");
    const dialog = await openPanel(page);

    await expect(dialog.getByText("Store message bodies")).toHaveCount(0);
    // And the ones that apply to both are there.
    await expect(dialog.getByText("Where notes go")).toBeVisible();
    await expect(dialog.getByText("Make notes for people")).toBeVisible();
  });
});

/**
 * The setup screen — options chosen before connecting.
 *
 * The payload is the thing worth pinning: every choice must reach the server
 * in the shape `connection_settings.clean` accepts, inside the start request,
 * because that is what rides the OAuth state and configures the first sync.
 * A wizard that renders beautifully and sends nothing would pass any visual
 * assertion.
 */

const CATALOG = {
  configured: true,
  providers: [
    {
      id: "google_calendar",
      name: "Google Calendar",
      blurb: "Events become notes.",
      caveats: ["Read-only."],
      scopes: [],
      available: true,
      self_hosted_only: false,
    },
    {
      id: "google_gmail",
      name: "Gmail",
      blurb: "Threads become notes.",
      caveats: ["Read-only."],
      scopes: [],
      available: true,
      self_hosted_only: true,
    },
  ],
};

async function openWizard(page: Page, providerName: string) {
  await page.route("**/api/v1/connections/providers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: CATALOG }),
    });
  });
  const dialog = await openConnectionsWith(page, []);
  // Scoped to the Live sync section: "Gmail" also matches the one-time
  // Takeout importer's card, which is a different thing entirely.
  await dialog
    .getByRole("region", { name: "Live sync" })
    .getByRole("button", { name: providerName })
    .click();
  await expect(dialog.getByTestId("sync-setup")).toBeVisible();
  return dialog;
}

function captureStart(page: Page): { body: () => Record<string, unknown> | null } {
  let captured: Record<string, unknown> | null = null;
  void page.route("**/api/v1/connections/google/start*", async (route) => {
    captured = route.request().postDataJSON() as Record<string, unknown>;
    // A same-page hash keeps the "navigate to Google" step from tearing the
    // page down under the assertion.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { url: "#google-consent", provider: "google_calendar" } }),
    });
  });
  return { body: () => captured };
}

test.describe("choosing before connecting", () => {
  test("the chosen options travel inside the start request", async ({ page }) => {
    await signupFreshUser(page, "wizard-payload");
    const start = captureStart(page);
    const dialog = await openWizard(page, "Google Calendar");

    await dialog.getByRole("button", { name: "7 days", exact: true }).click();
    await dialog.getByText("Link each note to its daily note").click();
    await dialog.getByRole("button", { name: "Connect Google Calendar" }).click();

    await expect.poll(() => start.body()).not.toBeNull();
    const settings = (start.body() as { settings: Record<string, unknown> }).settings;
    expect((settings.calendar as { backfill_days: number }).backfill_days).toBe(7);
    expect(settings.link_daily).toBe(false);
    expect(settings.link_people).toBe(true);
    expect(typeof settings.people_threshold).toBe("number");
  });

  test("future-only and a custom destination folder both arrive", async ({ page }) => {
    await signupFreshUser(page, "wizard-future");
    const start = captureStart(page);
    const dialog = await openWizard(page, "Google Calendar");

    await dialog.getByRole("button", { name: "Future only" }).click();
    await dialog.getByText("A new folder").click();
    await dialog.getByLabel("New folder name").fill("Sources/Google");
    await dialog.getByRole("button", { name: "Connect Google Calendar" }).click();

    await expect.poll(() => start.body()).not.toBeNull();
    const settings = (start.body() as { settings: Record<string, unknown> }).settings;
    expect((settings.calendar as { backfill_days: number }).backfill_days).toBe(0);
    expect(settings.folder_root).toBe("Sources/Google");
  });

  test("gmail's scope choices arrive too", async ({ page }) => {
    await signupFreshUser(page, "wizard-gmail");
    const start = captureStart(page);
    const dialog = await openWizard(page, "Gmail");

    await dialog.getByRole("button", { name: "starred", exact: true }).click();
    await dialog.getByText("Store message bodies").click();
    await dialog.getByLabel("Senders to skip").fill("noreply@shop.com\npromo-mail.com");
    await dialog.getByRole("button", { name: "Connect Gmail" }).click();

    await expect.poll(() => start.body()).not.toBeNull();
    const gmail = (start.body() as { settings: { gmail: Record<string, unknown> } }).settings.gmail;
    expect(gmail.labels).toEqual(["INBOX", "STARRED"]);
    expect(gmail.store_bodies).toBe(true);
    expect(gmail.exclude_senders).toEqual(["noreply@shop.com", "promo-mail.com"]);
  });
});

/**
 * The floating progress card.
 *
 * Its whole reason to exist is surviving the page: the state is the server's,
 * so a reload mid-import shows the card again without being asked. These stub
 * the connections endpoint the same way as above — the shape is pinned by the
 * backend suite — and drive the card's controls.
 */
test.describe("the sync progress card", () => {
  test("a running import shows, counts, pauses, and can keep future only", async ({ page }) => {
    const verbs: string[] = [];
    await page.route("**/api/v1/connections/connections", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            connection({
              vault_id: "PATCHED-BELOW",
              last_run: {},
              streams: [
                {
                  stream: "calendar:events:primary",
                  backfill_done: false,
                  records_seen: 1234,
                  last_success_at: null,
                  syncing: true,
                },
              ],
            }),
          ].map((row) => ({ ...row, vault_id: new URL(page.url()).pathname.split("/")[2] })),
        }),
      });
    });
    for (const verb of ["pause", "resume", "skip-backfill"]) {
      await page.route(`**/api/v1/connections/connections/*/${verb}`, async (route) => {
        verbs.push(verb);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: connection() }),
        });
      });
    }
    await signupFreshUser(page, "progress-card");

    const card = page.getByTestId("sync-progress");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/1,234 items so far/)).toBeVisible();
    await expect(card.getByText(/Importing Google Calendar/)).toBeVisible();

    await card.getByRole("button", { name: "Pause" }).click();
    await expect.poll(() => verbs).toContain("pause");

    await card.getByRole("button", { name: "Keep future only" }).click();
    // The confirm says what the button does — not "Delete", because nothing is.
    const confirm = page.getByRole("dialog").filter({ hasText: "Stop importing history" });
    await expect(confirm.getByText(/already imported are kept/)).toBeVisible();
    await confirm.getByRole("button", { name: "Keep future only" }).click();
    await expect.poll(() => verbs).toContain("skip-backfill");
  });

  test("a finished import becomes a closable notice", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/v1/connections/connections", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      calls += 1;
      const done = calls > 2;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            connection({
              last_run: {},
              streams: [
                {
                  stream: "calendar:events:primary",
                  backfill_done: done,
                  records_seen: 111,
                  last_success_at: done ? "2026-09-01T10:00:00+00:00" : null,
                  syncing: !done,
                },
              ],
            }),
          ].map((row) => ({ ...row, vault_id: new URL(page.url()).pathname.split("/")[2] })),
        }),
      });
    });
    await signupFreshUser(page, "progress-done");

    const card = page.getByTestId("sync-progress");
    await expect(card.getByText(/Importing Google Calendar/)).toBeVisible({ timeout: 15_000 });
    // The 3-second poll flips it to done a couple of ticks later.
    await expect(card.getByText(/import finished/)).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText(/111 items/)).toBeVisible();

    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0);
  });
});
