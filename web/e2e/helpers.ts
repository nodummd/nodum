import { expect, type Page } from "@playwright/test";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@nodumtest.dev`;
}

export const PASSWORD = "e2e-Password-123!";

/** Sign up a fresh user and wait for the workspace to load the welcome vault. */
export async function signupFreshUser(page: Page, prefix = "e2e"): Promise<string> {
  const email = uniqueEmail(prefix);
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
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

/** The CodeMirror editing surface of the active note. */
export function editorSurface(page: Page) {
  return page.locator(".cm-content").first();
}
