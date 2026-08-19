import { expect, type Page } from "@playwright/test";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@nodumtest.dev`;
}

export const PASSWORD = "e2e-Password-123!";

/** Outside production the verification code is fixed (EMAIL_OTP_DEV_CODE). */
export const DEV_OTP = "123456";

/**
 * Fill the verification code if the deployment asks for one. Signup lands on
 * the code step whenever EMAIL_VERIFICATION_REQUIRED is on — the default —
 * and goes straight to the vault when it is off, so this handles both.
 */
export async function passEmailVerification(page: Page): Promise<void> {
  const field = page.getByLabel("Verification code");
  const shown = await field
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await field.fill(DEV_OTP); // six digits submits on its own
}

/**
 * A brand-new account gets the first-run experience: the Demo Workspace
 * question (and the onboarding tour). Almost every test wants a plain, quiet
 * workspace, so this answers them the way a person in a hurry would — but
 * through the real UI, never by poking flags into the database.
 */
export async function dismissFirstRun(page: Page): Promise<void> {
  const notNow = page.getByRole("button", { name: "Not now" });
  const shown = await notNow
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) {
    await notNow.click();
    await expect(page.getByTestId("demo-offer")).toHaveCount(0, { timeout: 10_000 });
  }
}

/** Sign up a fresh user and wait for the workspace to load the welcome vault.
 *  Pass `{ keepFirstRun: true }` to leave the first-run prompts up. */
export async function signupFreshUser(
  page: Page,
  prefix = "e2e",
  opts: { keepFirstRun?: boolean } = {},
): Promise<string> {
  const email = uniqueEmail(prefix);
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await passEmailVerification(page);
  await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
  // First: the first-run prompt is a modal, and while it is up everything
  // behind it is aria-hidden — the checks below would not find the workspace.
  if (!opts.keepFirstRun) await dismissFirstRun(page);
  // Welcome vault is seeded — explorer shows the notes (desktop) or the
  // mobile top bar renders (drawer explorer starts closed)
  await expect(
    page
      .getByText("Welcome to Nodum")
      .first()
      .or(page.getByRole("button", { name: "Open navigation" })),
  ).toBeVisible({ timeout: 15_000 });
  return email;
}

/** Open a note via the file explorer. */
export async function openNoteFromExplorer(page: Page, title: string): Promise<void> {
  await page.getByText(title, { exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title, {
    timeout: 10_000,
  });
}

/**
 * Create a note through the API from inside the page (uses the refresh
 * cookie). Avoids typing markdown through CodeMirror, which rewrites input
 * (list continuation, auto-pairs) and corrupts fixture content.
 */
export async function createNoteViaApi(page: Page, title: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ title, content }) => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const vaults = await (
        await fetch("/api/v1/vaults", { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      await fetch(`/api/v1/vaults/${vaults.data[0].id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, content }),
      });
    },
    { title, content },
  );
}

/** Create a folder and a note inside it through the API (see above). */
export async function createNoteInFolderViaApi(
  page: Page,
  folder: string,
  title: string,
  content = "",
): Promise<void> {
  await page.evaluate(
    async ({ folder, title, content }) => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const vaults = await (await fetch("/api/v1/vaults", { headers })).json();
      const vaultId = vaults.data[0].id;
      const created = await (
        await fetch(`/api/v1/vaults/${vaultId}/folders`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: folder }),
        })
      ).json();
      // Called twice with the same folder name → reuse the existing one.
      let folderId = created.data?.id;
      if (!folderId) {
        const tree = await (await fetch(`/api/v1/vaults/${vaultId}/tree`, { headers })).json();
        folderId = tree.data.items.find(
          (i: { type: string; name?: string }) => i.type === "folder" && i.name === folder,
        )?.id;
      }
      await fetch(`/api/v1/vaults/${vaultId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, folder_id: folderId, content }),
      });
    },
    { folder, title, content },
  );
}

/** The CodeMirror editing surface of the active note. */
export function editorSurface(page: Page) {
  return page.locator(".cm-content").first();
}
