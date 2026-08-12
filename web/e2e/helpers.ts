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
  // Welcome vault is seeded — explorer shows the notes
  await expect(page.getByText("Welcome to Nodum").first()).toBeVisible({ timeout: 15_000 });
  return email;
}

/** Open a note via the file explorer. */
export async function openNoteFromExplorer(page: Page, title: string): Promise<void> {
  await page.getByText(title, { exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title, {
    timeout: 10_000,
  });
}

/** The CodeMirror editing surface of the active note. */
export function editorSurface(page: Page) {
  return page.locator(".cm-content").first();
}
