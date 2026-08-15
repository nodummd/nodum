import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/** The per-note ⋯ menu, the breadcrumb, and reveal-on-navigate. */

async function openNoteMenu(page: Page) {
  await page.getByRole("button", { name: "More options" }).click();
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  return menu;
}

/** Create a note inside a folder, via the API, and return nothing. */
async function createInFolder(page: Page, folder: string, title: string, content: string) {
  await page.evaluate(
    async ({ folder, title, content }) => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const vaults = await (await fetch("/api/v1/vaults", { headers })).json();
      const vaultId = vaults.data[0].id;
      const f = await (
        await fetch(`/api/v1/vaults/${vaultId}/folders`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: folder }),
        })
      ).json();
      await fetch(`/api/v1/vaults/${vaultId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, content, folder_id: f.data.id }),
      });
    },
    { folder, title, content },
  );
}

test.describe("note menu", () => {
  test("lists the file commands", async ({ page }) => {
    await signupFreshUser(page, "notemenu-list");
    await createNoteViaApi(page, "Menu target", "body\n");
    await page.reload();
    await openNoteFromExplorer(page, "Menu target");

    const menu = await openNoteMenu(page);
    for (const label of [
      "Backlinks in document",
      "Reading view",
      "Source mode",
      "Split right",
      "Split down",
      "Open in new window",
      "Rename…",
      "Move file to…",
      "Merge entire file with…",
      "Add file property",
      "Export to PDF…",
      "Find…",
      "Replace…",
      "Copy path",
      "Open version history",
      "Open linked view",
      "Reveal file in navigation",
      "Delete file",
    ]) {
      await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
    }
  });

  test("backlinks in document renders the linked mentions", async ({ page }) => {
    await signupFreshUser(page, "notemenu-backlinks");
    await createNoteViaApi(page, "Target note", "I am linked.\n");
    await createNoteViaApi(page, "Source note", "See [[Target note]].\n");
    await page.reload();
    await openNoteFromExplorer(page, "Target note");

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Backlinks in document", exact: true }).click();

    const section = page.getByRole("region", { name: "Backlinks" });
    await expect(section).toContainText("Linked mentions (1)");
    await expect(section.getByRole("button", { name: "Source note" })).toBeVisible();
  });

  test("add file property writes frontmatter into the document", async ({ page }) => {
    await signupFreshUser(page, "notemenu-prop");
    await createNoteViaApi(page, "Prop note", "body\n");
    await page.reload();
    await openNoteFromExplorer(page, "Prop note");
    await editorSurface(page).click();

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Add file property", exact: true }).click();

    await page.getByRole("button", { name: "Source mode" }).click();
    await expect(editorSurface(page)).toContainText("key: value");
  });

  test("breadcrumb shows the folder path and renames the note", async ({ page }) => {
    await signupFreshUser(page, "breadcrumb");
    await createInFolder(page, "Projects", "Deep note", "hello\n");
    await page.reload();
    await openNoteFromExplorer(page, "Deep note");

    const crumb = page.getByRole("navigation", { name: "Note location" });
    await expect(crumb).toContainText("Projects");
    await expect(crumb).toContainText("Deep note");

    await crumb.getByRole("button", { name: "Note path" }).click();
    const input = crumb.getByRole("textbox", { name: "Rename note" });
    await input.fill("Renamed via crumb");
    await input.press("Enter");

    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Renamed via crumb");
    await expect(crumb).toContainText("Renamed via crumb");
  });

  test("opening a note anywhere selects and expands it in the explorer", async ({ page }) => {
    await signupFreshUser(page, "reveal");
    await createInFolder(page, "Archive", "Buried note", "content\n");
    await createNoteViaApi(page, "Jumping off", "Go to [[Buried note]].\n");
    await page.reload();
    await openNoteFromExplorer(page, "Jumping off");

    // Collapse everything so the buried note is not rendered at all.
    await page.getByRole("button", { name: /Collapse all|Expand all/ }).click();
    await expect(page.locator('[data-note-id]:has-text("Buried note")')).toHaveCount(0);

    // Navigate by wikilink — no explorer interaction whatsoever.
    await editorSurface(page).getByText("Buried note").click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Buried note", {
      timeout: 10_000,
    });

    // The explorer expanded "Archive" and marked the row active.
    const row = page.locator("[data-note-id][data-active]");
    await expect(row).toHaveText(/Buried note/);
  });

  test("reveal file in navigation re-selects the open note", async ({ page }) => {
    await signupFreshUser(page, "reveal-cmd");
    await createInFolder(page, "Deep", "Hidden note", "content\n");
    await page.reload();
    await openNoteFromExplorer(page, "Hidden note");

    await page.getByRole("button", { name: /Collapse all|Expand all/ }).click();
    await expect(page.locator("[data-note-id][data-active]")).toHaveCount(0);

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Reveal file in navigation", exact: true }).click();

    await expect(page.locator("[data-note-id][data-active]")).toHaveText(/Hidden note/);
  });

  test("move file to relocates the note", async ({ page }) => {
    await signupFreshUser(page, "notemenu-move");
    await createInFolder(page, "Inbox", "Wandering note", "content\n");
    await page.reload();
    await openNoteFromExplorer(page, "Wandering note");
    await expect(page.getByRole("navigation", { name: "Note location" })).toContainText("Inbox");

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Move file to…", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Vault root", exact: true }).click();

    await expect(page.getByRole("navigation", { name: "Note location" })).not.toContainText("Inbox");
  });
});
