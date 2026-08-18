import { expect, test } from "@playwright/test";

import { DEV_OTP, PASSWORD, passEmailVerification, signupFreshUser, uniqueEmail } from "./helpers";

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
    await passEmailVerification(page);
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

/** Signup asks for a code (dev: always 123456; production mails a random one). */
test.describe("email verification", () => {
  test("a wrong code is rejected, the right one lands in the vault", async ({ page }) => {
    const email = uniqueEmail("verify-e2e");
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Verify Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(email)).toBeVisible();

    // Six digits submit on their own, so a wrong code needs no button press.
    await page.getByLabel("Verification code").fill("000000");
    await expect(page.getByText(/not correct/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/signup/);

    await page.getByLabel("Verification code").fill(DEV_OTP);
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
  });

  test("logging in before verifying routes to the code step, not a dead end", async ({ page }) => {
    const email = uniqueEmail("verify-login");
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Half Done");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 15_000,
    });

    // Walk away mid-signup, then come back through the login form.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 15_000,
    });
    await passEmailVerification(page);
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
  });
});

/** Forgotten password: code + new password in one step, old sessions dropped. */
test.describe("password reset", () => {
  test("a reset code sets a new password and signs in", async ({ page }) => {
    const email = await signupFreshUser(page, "reset-e2e");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Forgot password?" }).click();

    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("Reset code").fill("000000");
    await page.getByLabel("New password").fill("a-Brand-New-Pass1");
    await page.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(page.getByText(/not correct/i)).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Reset code").fill(DEV_OTP);
    await page.getByLabel("New password").fill("a-Brand-New-Pass1");
    await page.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });

    // The new password is the one that works now.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Password").fill("a-Brand-New-Pass1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
  });
});

/** Account settings: changing the password, and closing the account for good. */
test.describe("account settings", () => {
  test("the password can be changed from settings", async ({ page }) => {
    const email = await signupFreshUser(page, "changepw-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("Current").fill(PASSWORD);
    await dialog.getByLabel("New (min 8)").fill("changed-Password-9");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible({ timeout: 10_000 });

    // Changing it logs every session out, so the app returns to the login page.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("changed-Password-9");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/vault\//, { timeout: 15_000 });
  });

  test("deleting the account needs the emailed code, then takes everything", async ({ page }) => {
    const email = await signupFreshUser(page, "delete-e2e");

    await page.keyboard.press("ControlOrMeta+Comma");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });

    await dialog.getByRole("button", { name: "Delete account" }).click();
    await dialog.getByRole("button", { name: "Email me a code" }).click();
    await expect(dialog.getByLabel("Confirmation code")).toBeVisible({ timeout: 10_000 });

    await dialog.getByLabel("Confirmation code").fill("000000");
    await dialog.getByRole("button", { name: "Delete my account permanently" }).click();
    await expect(page.getByText(/not correct/i)).toBeVisible({ timeout: 10_000 });

    await dialog.getByLabel("Confirmation code").fill(DEV_OTP);
    await dialog.getByRole("button", { name: "Delete my account permanently" }).click();

    // Back to the landing page, and the account no longer exists.
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });
  });
});
