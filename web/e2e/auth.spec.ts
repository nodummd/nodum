import { expect, test } from "@playwright/test";

import { PASSWORD, signupFreshUser, uniqueEmail } from "./helpers";

test.describe("auth", () => {
  test("signup lands in a seeded welcome vault", async ({ page }) => {
    await signupFreshUser(page, "auth-signup");
    await expect(page.getByText("Linking your thinking").first()).toBeVisible();
    await expect(page.getByText("Formatting showcase").first()).toBeVisible();
  });

  test("session survives a full page reload", async ({ page }) => {
    await signupFreshUser(page, "auth-reload");
    await page.reload();
    await expect(page.getByText("Welcome to Nodum").first()).toBeVisible({ timeout: 15_000 });
  });

  test("logout then login round-trips", async ({ page }) => {
    const email = await signupFreshUser(page, "auth-roundtrip");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
    await expect(page.getByText("Welcome to Nodum").first()).toBeVisible({ timeout: 15_000 });
  });

  test("wrong password shows an error, not a redirect", async ({ page }) => {
    const email = await signupFreshUser(page, "auth-wrongpw");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated /vault redirects to login", async ({ page }) => {
    await page.goto("/vault");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("duplicate signup is rejected with a visible error", async ({ page }) => {
    const email = uniqueEmail("auth-dup");
    await page.goto("/signup");
    await page.getByLabel("Name").fill("First");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });

    await page.getByRole("button", { name: "Log out" }).click();
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Second");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 10_000 });
  });
});
