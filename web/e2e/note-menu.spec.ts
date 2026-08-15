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

  test("find and replace open the panel focused on their own field", async ({ page }) => {
    await signupFreshUser(page, "notemenu-find");
    await createNoteViaApi(page, "Search me", "alpha beta gamma\n");
    await page.reload();
    await openNoteFromExplorer(page, "Search me");

    let menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Find…", exact: true }).click();
    await expect(page.locator(".cm-search")).toBeVisible();
    await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();

    // Replace must not be a duplicate of Find — it lands in the other field.
    menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Replace…", exact: true }).click();
    await expect(page.locator('.cm-search input[name="replace"]')).toBeFocused();
  });

  test("editor commands work from reading view, where no editor is mounted", async ({ page }) => {
    await signupFreshUser(page, "notemenu-reading");
    await createNoteViaApi(page, "Reading note", "some text\n");
    await page.reload();
    await openNoteFromExplorer(page, "Reading note");

    await page.getByRole("button", { name: "Reading view" }).click();
    await expect(page.locator(".cm-content")).toHaveCount(0);

    // Previously a silent no-op: the command needs a CodeMirror view and
    // reading view has none.
    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Find…", exact: true }).click();

    await expect(page.getByRole("button", { name: "Live preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".cm-search")).toBeVisible();
  });

  test("export to pdf prints from reading view", async ({ page }) => {
    await signupFreshUser(page, "notemenu-pdf");
    await createNoteViaApi(page, "Printable", "content\n");
    await page.reload();
    await openNoteFromExplorer(page, "Printable");

    // Reading view renders the whole document; CodeMirror only builds the lines
    // near the viewport, so printing from the editor would truncate long notes.
    await page.evaluate(() => {
      const w = window as unknown as { __printMode?: string | null };
      window.print = () => {
        w.__printMode =
          document.querySelector('button[aria-pressed="true"][aria-label="Reading view"]') === null
            ? "not-reading"
            : "reading";
      };
    });

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Export to PDF…", exact: true }).click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printMode?: string }).__printMode))
      .toBe("reading");
  });

  test("printing shows the note and hides the application chrome", async ({ page }) => {
    await signupFreshUser(page, "notemenu-printcss");
    await createNoteViaApi(page, "Print scope", "the body\n");
    await page.reload();
    await openNoteFromExplorer(page, "Print scope");

    await page.emulateMedia({ media: "print" });
    // Computed visibility, not toBeVisible(): every ancestor of the note is
    // hidden by the print rules, which Playwright's visibility heuristic reads
    // as "not visible" even though the note itself paints.
    const seen = await page.evaluate(() => ({
      note: getComputedStyle(document.querySelector("[data-print-root]")!).visibility,
      explorer: getComputedStyle(document.querySelector('[role="tree"]')!).visibility,
    }));
    await page.emulateMedia({ media: null });
    expect(seen.note).toBe("visible");
    expect(seen.explorer).toBe("hidden");
  });

  test("split right opens the note in a second pane", async ({ page }) => {
    await signupFreshUser(page, "notemenu-split");
    await createNoteViaApi(page, "Splittable", "content\n");
    await page.reload();
    await openNoteFromExplorer(page, "Splittable");
    await expect(page.getByLabel(/^Editor pane/)).toHaveCount(1);

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Split right", exact: true }).click();

    await expect(page.getByLabel(/^Editor pane/)).toHaveCount(2);
  });

  test("rename focuses the title, copy path copies it, version history opens", async ({ page }) => {
    await signupFreshUser(page, "notemenu-misc");
    await createInFolder(page, "Docs", "Utility note", "content\n");
    await page.reload();
    await openNoteFromExplorer(page, "Utility note");

    let menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Rename…", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();

    await page.evaluate(() => {
      const w = window as unknown as { __copied?: string };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (t: string) => {
            w.__copied = t;
            return Promise.resolve();
          },
        },
      });
    });
    menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Copy path", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied))
      .toBe("Docs/Utility note");

    menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Open version history", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("delete file removes the note and closes its tab", async ({ page }) => {
    await signupFreshUser(page, "notemenu-delete");
    await createNoteViaApi(page, "Doomed note", "content\n");
    await page.reload();
    await openNoteFromExplorer(page, "Doomed note");

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Delete file", exact: true }).click();
    // confirmDelete is on by default.
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(
      page.getByRole("tree", { name: "File explorer" }).getByText("Doomed note", { exact: true }),
    ).toHaveCount(0);
  });

  test("merge appends the other note and deletes it", async ({ page }) => {
    await signupFreshUser(page, "notemenu-merge");
    await createNoteViaApi(page, "Merge target", "first body\n");
    await createNoteViaApi(page, "Merge source", "second body\n");
    await page.reload();
    await openNoteFromExplorer(page, "Merge target");

    const menu = await openNoteMenu(page);
    await menu.getByRole("menuitem", { name: "Merge entire file with…", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Merge source", exact: true }).click();

    await expect(editorSurface(page)).toContainText("second body");
    await expect(
      page.getByRole("tree", { name: "File explorer" }).getByText("Merge source", { exact: true }),
    ).toHaveCount(0);
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
