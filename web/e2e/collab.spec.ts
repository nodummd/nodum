import { expect, test } from "@playwright/test";

import {
  createNoteViaApi,
  editorSurface,
  openNoteFromExplorer,
  PASSWORD,
  signupFreshUser,
} from "./helpers";

test.describe("live collaboration", () => {
  test("two contexts edit one note live; cursors show; refresh keeps content", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const email = await signupFreshUser(pageA, "collab-e2e");

    // Opt the vault into collab (beta flag) via API
    await pageA.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const vaults = await (
        await fetch("/api/v1/vaults", { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      await fetch(`/api/v1/vaults/${vaults.data[0].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: { collabEnabled: true } }),
      });
    });
    await createNoteViaApi(pageA, "Live note", "Shared start.");
    await pageA.reload();
    await openNoteFromExplorer(pageA, "Live note");
    await expect(editorSurface(pageA)).toContainText("Shared start.", { timeout: 15_000 });

    // Second context, same account (multi-device story)
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto("/login");
    await pageB.getByLabel("Email").fill(email);
    await pageB.getByLabel("Password").fill(PASSWORD);
    await pageB.getByRole("button", { name: "Log in" }).click();
    await expect(pageB).toHaveURL(/\/vault\//, { timeout: 15_000 });
    await openNoteFromExplorer(pageB, "Live note");
    await expect(editorSurface(pageB)).toContainText("Shared start.", { timeout: 15_000 });

    // A types → B sees it live (no reload)
    await editorSurface(pageA).click();
    await pageA.keyboard.press("ControlOrMeta+ArrowDown");
    await pageA.keyboard.type(" From A.");
    await expect(editorSurface(pageB)).toContainText("From A.", { timeout: 10_000 });

    // Presence: B renders A's remote caret
    await expect(pageB.locator(".cm-ySelectionCaret").first()).toBeVisible({ timeout: 10_000 });

    // Persistence: a refreshed client gets the merged content back
    await pageB.reload();
    await openNoteFromExplorer(pageB, "Live note");
    await expect(editorSurface(pageB)).toContainText("Shared start. From A.", {
      timeout: 15_000,
    });

    await ctxA.close();
    await ctxB.close();
  });
});
