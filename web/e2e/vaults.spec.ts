import { expect, test, type Page } from "@playwright/test";

import { openNoteFromExplorer, openNoteInNewTab, signupFreshUser } from "./helpers";

/** Multiple vaults: each is a separate workspace, and opening one launches it
 *  in its own browser tab so two can be worked in at once. */

const switcher = (page: Page) => page.getByRole("button", { name: /Switch vault/ });

/** Create a vault through the switcher and return the page it opens in. */
async function createVault(page: Page, name: string): Promise<Page> {
  await switcher(page).click();
  await page.getByRole("menuitem", { name: "New vault…" }).click();
  await page.getByRole("textbox", { name: "Vault name" }).fill(name);
  await page.getByRole("button", { name: "Create vault" }).click();

  const opened = page.waitForEvent("popup");
  await page.getByRole("link", { name: `Open ${name}` }).click();
  const next = await opened;
  // Close the dialog in the original tab: an open Radix dialog aria-hides the
  // rest of that page, so nothing behind it is findable by role.
  await page.keyboard.press("Escape");
  await expect(next.getByRole("button", { name: /Switch vault/ })).toContainText(name, {
    timeout: 20_000,
  });
  return next;
}

test.describe("multiple vaults", () => {
  test("a new vault is a separate, empty workspace in its own tab", async ({ page }) => {
    await signupFreshUser(page, "vault-new");
    await expect(switcher(page)).toContainText("My Vault");

    const next = await createVault(page, "Research");

    await expect(next).toHaveTitle("Research — Nodum");
    await expect(next.getByRole("button", { name: /Switch vault/ })).toContainText("Research", {
      timeout: 15_000,
    });
    // Nothing crosses over: no notes, and no tabs from the vault we came from.
    await expect(next.getByText("Welcome to Nodum")).toHaveCount(0);
    await expect(next.getByRole("tab")).toHaveCount(0);
    await next.close();
  });

  test("switching to another vault opens it in a new browser tab", async ({ page }) => {
    await signupFreshUser(page, "vault-switch");
    const created = await createVault(page, "Archive");
    await created.close();

    // The original tab is untouched by the switch — that is the whole point.
    await expect(switcher(page)).toContainText("My Vault");
    await switcher(page).click();
    const opened = page.waitForEvent("popup");
    await page.getByRole("menuitem", { name: "Archive" }).click();
    const next = await opened;
    await expect(next).toHaveURL(/\/vault\/[0-9a-f-]+$/);
    await expect(next).toHaveTitle("Archive — Nodum");
    await expect(page).toHaveTitle("My Vault — Nodum");
    await next.close();
  });

  test("two vaults keep separate tab strips across reloads", async ({ page }) => {
    await signupFreshUser(page, "vault-layout");
    await openNoteFromExplorer(page, "Welcome to Nodum");
    await openNoteInNewTab(page, "Formatting showcase");
    await expect(page.getByRole("tab")).toHaveCount(2);

    // Work in the second vault: it gets its own layout…
    const other = await createVault(page, "Second");
    await other.keyboard.press("ControlOrMeta+g");
    await expect(other.getByRole("tab")).toHaveCount(1);
    await other.reload();
    await expect(other.getByRole("tab")).toHaveCount(1);

    // …and writing it must not have clobbered the first vault's.
    await page.reload();
    await expect(page.getByRole("tab")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByRole("tab", { name: /Welcome to Nodum/ })).toBeVisible();
    await other.close();
  });

  test("settings lists the vaults, renames them, and refuses to delete the last", async ({
    page,
  }) => {
    await signupFreshUser(page, "vault-manage");

    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("button", { name: "Vault", exact: true }).click();
    const only = page.getByRole("textbox", { name: "Vault name: My Vault" });
    await expect(only).toBeVisible();
    // One vault left = nothing to fall back to, so deleting is not offered.
    await expect(page.getByRole("button", { name: "Delete vault My Vault" })).toBeDisabled();

    await only.fill("Renamed vault");
    await only.press("Enter");
    await expect(page.getByRole("textbox", { name: "Vault name: Renamed vault" })).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("Escape");
    await expect(switcher(page)).toContainText("Renamed vault");
  });
});
