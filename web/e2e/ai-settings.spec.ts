import { expect, test, type Page } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** Settings → AI: bring your own provider key. The key goes in and never comes
 *  back out — not to this screen, not to any other API response. */

const FAKE_KEY = "sk-ant-e2e-NEVER-ECHO-9182";

async function openAiSettings(page: Page) {
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.getByText("AI PROVIDER")).toBeVisible();
}

/** Every AI/auth response body this account can fetch, as one string. */
async function allResponses(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const token = (await (await fetch("/api/v1/auth/refresh", { method: "POST" })).json()).data
      .access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const bodies = await Promise.all(
      ["/api/v1/ai/status", "/api/v1/auth/me"].map((url) =>
        fetch(url, { headers }).then((r) => r.text()),
      ),
    );
    return bodies.join("\n");
  });
}

test.describe("AI settings", () => {
  test("a saved key is stored, hinted, and never returned", async ({ page }) => {
    await signupFreshUser(page, "ai-settings");
    await openAiSettings(page);

    // Nothing configured yet: no hint, and Test has nothing to test.
    await expect(page.getByRole("button", { name: "Test connection" })).toBeDisabled();

    await page.getByLabel(/API key/).fill(FAKE_KEY);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText(`stored: sk-ant…9182`)).toBeVisible({ timeout: 10_000 });
    // The field is cleared — the key is gone from the DOM as well.
    await expect(page.getByLabel(/API key/)).toHaveValue("");

    const bodies = await allResponses(page);
    expect(bodies).not.toContain(FAKE_KEY);
    expect(bodies).toContain("sk-ant…9182");
  });

  test("the model can be changed without re-pasting the key, and the key can be removed", async ({
    page,
  }) => {
    await signupFreshUser(page, "ai-model");
    await openAiSettings(page);
    await page.getByLabel(/API key/).fill(FAKE_KEY);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`stored: sk-ant…9182`)).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Model").fill("claude-haiku-4-5");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/anthropic · claude-haiku-4-5/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Remove .* key/ }).click();
    await expect(page.getByText(/stored: sk-ant/)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  test("each provider keeps its own key", async ({ page }) => {
    await signupFreshUser(page, "ai-multi");
    await openAiSettings(page);

    await page.getByLabel(/API key/).fill(FAKE_KEY);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`stored: sk-ant…9182`)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "OpenAI" }).click();
    // Switching provider must not show the other provider's key as stored.
    await expect(page.getByText(/stored: sk-ant/)).toHaveCount(0);
    await page.getByLabel(/API key/).fill("sk-openai-e2e-4455");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("stored: sk-ope…4455")).toBeVisible({ timeout: 10_000 });

    // Both are configured; the last one saved is the active one.
    await expect(page.getByText(/openai · gpt/)).toBeVisible();
    await page.getByRole("button", { name: /Claude \(Anthropic\)/ }).click();
    await expect(page.getByText(`stored: sk-ant…9182`)).toBeVisible();
  });
});
