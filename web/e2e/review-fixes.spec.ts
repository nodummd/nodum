import { expect, test } from "@playwright/test";

import {
  createNoteViaApi,
  editorSurface,
  openNoteFromExplorer,
  passEmailVerification,
  PASSWORD,
  signupFreshUser,
  uniqueEmail,
} from "./helpers";

/** Follow-ups from the adversarial review of the first-run work. */

test.describe("first-run follow-ups", () => {
  test("the veil follows a window resize on a centred step, and the card fits a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await signupFreshUser(page, "tour-resize", { keepFirstRun: true });
    const tour = page.getByTestId("tour");
    const card = page.getByTestId("tour-card");
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveAttribute("data-step", "welcome");

    await page.setViewportSize({ width: 1400, height: 900 });
    await expect
      .poll(async () => (await tour.locator("svg > path").first().getAttribute("d")) ?? "", { timeout: 3_000 })
      .toContain("H1400V900");
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    expect(Math.abs(box!.x + box!.width / 2 - 700)).toBeLessThan(4);

    // Narrow: first run never shows the tour on a phone — but Settings can
    // re-open it, and then the card never overflows the viewport, so × stays
    // reachable.
    await page.setViewportSize({ width: 375, height: 700 });
    await expect(tour).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "Show the tour again" }).dispatchEvent("click");
    await expect(card).toBeVisible();
    await expect.poll(async () => (await card.boundingBox())!.width, { timeout: 3_000 }).toBeLessThanOrEqual(351);
    const close = card.getByRole("button", { name: "Close tour" });
    const closeBox = await close.boundingBox();
    expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(375);
  });

  test("creating the demo lands in the demo vault even when the vault list refetch is slow", async ({
    page,
  }) => {
    await signupFreshUser(page, "demo-slow", { keepFirstRun: true });
    const tour = page.getByTestId("tour");
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await tour.getByRole("button", { name: "Skip" }).click();
    // The list refetch after creation is slower than the client-side navigation:
    // the vault page must not bounce back to the old vault on a stale list.
    await page.route("**/api/v1/vaults", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const visited: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
    });
    await tour.getByRole("button", { name: "Create demo workspace" }).click();
    await expect(page.getByRole("button", { name: /Switch vault/ })).toContainText("Demo Workspace", {
      timeout: 30_000,
    });
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Home", { timeout: 15_000 });
    expect(visited.filter((p) => p === "/vault")).toHaveLength(0);
  });

  test("⌘E toggles reading view without touching the note", async ({ page }) => {
    await signupFreshUser(page, "cmd-e");
    await createNoteViaApi(page, "Plain note", "just words here");
    await page.reload();
    await openNoteFromExplorer(page, "Plain note");
    await editorSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("ControlOrMeta+e");
    await expect(page.locator(".nodum-reading")).toContainText("just words here");
    await expect(page.locator(".nodum-reading")).not.toContainText("`");
    await page.keyboard.press("ControlOrMeta+e");
    await expect(editorSurface(page)).toContainText("just words here");
    await expect(editorSurface(page)).not.toContainText("`");
  });

  test("logging out and in as someone else in the same tab starts clean — no cached vault, notes, or dialogs", async ({
    page,
  }) => {
    // Account A: a note, Settings left open, then log out via the palette
    // (SPA navigation all the way — no reload clears anything for us).
    await signupFreshUser(page, "leak-a");
    await createNoteViaApi(page, "A Secret Note", "top secret content of A");
    await page.reload();
    await openNoteFromExplorer(page, "A Secret Note");
    const aUrl = page.url();
    await page.keyboard.press("ControlOrMeta+,");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+p");
    await page.getByPlaceholder("Select a command...").fill("log out");
    await page.getByRole("option", { name: /Log out/ }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // Account B signs up through the marketing nav (client-side link) …
    await page.getByRole("link", { name: "Log in" }).first().click();
    await page.getByRole("link", { name: "Create an account" }).click();
    const emailB = uniqueEmail("leak-b");
    await page.getByLabel("Name").fill("B");
    await page.getByLabel("Email").fill(emailB);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await passEmailVerification(page);
    await expect(page).toHaveURL(/\/vault\//, { timeout: 20_000 });
    // … and lands in B's own vault: not A's URL, none of A's notes, no
    // Settings dialog left over, and the first-run tour usable.
    expect(page.url()).not.toBe(aUrl);
    await expect(page.getByTestId("tour")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByText("A Secret Note")).toHaveCount(0);
    await expect(page.getByText("top secret content of A")).toHaveCount(0);
    await page.getByTestId("tour-card").getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "explorer");
  });

  test("deleting the vault open in this tab lands on another vault, not on 'Loading vault…'", async ({
    page,
  }) => {
    await signupFreshUser(page, "vault-gone");
    const before = page.url();
    // A second vault to be left with.
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "Vault", exact: true }).click();
    await page.getByRole("button", { name: "New vault" }).click();
    await page.getByLabel("Vault name", { exact: true }).fill("Spare");
    await page.getByRole("button", { name: "Create vault" }).click();
    await expect(page.getByRole("link", { name: "Open Spare" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Delete the vault marked "Open here".
    const row = page.locator("li", { hasText: "Open here" });
    await row.getByRole("button", { name: /^Delete vault/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    // Not stranded: the tab hops to the remaining vault and shows a workspace.
    await expect(page).not.toHaveURL(before, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/vault\/[0-9a-f-]{36}$/);
    await expect(page.locator('[data-tour="explorer"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Loading vault…")).toHaveCount(0);
  });
});
