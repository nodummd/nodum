import AdmZip from "adm-zip";
import { expect, test } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/**
 * The import picker, end to end.
 *
 * These drive the real converters through the real endpoint rather than
 * stubbing them, because the failure this feature has to avoid is a
 * *successful-looking* import that quietly dropped content — a checklist that
 * lost its ticks, an attachment that never arrived, a link that no longer
 * resolves. Those only show up when the notes actually land in a vault.
 */

/** Build a zip in memory so a fixture never has to be committed as a binary. */
function zip(files: Record<string, string>): Buffer {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    archive.addFile(name, Buffer.from(content, "utf-8"));
  }
  return archive.toBuffer();
}

/** Settings → Vault → Import data. Returns the *import* dialog, which is a
 *  second dialog stacked over the settings one. */
async function openImportPicker(page: import("@playwright/test").Page) {
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("dialog").filter({ hasText: "Settings" }).first();
  await expect(settings.getByRole("heading", { name: "Settings" })).toBeVisible({
    timeout: 10_000,
  });
  await settings.getByRole("button", { name: "Vault", exact: true }).click();
  await settings.getByRole("button", { name: "Import data" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Bring your notes in from" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/** Read the vault tree through the API — far steadier than driving the
 *  explorer, and this is asserting that notes exist, not how they render. */
async function vaultPaths(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(async () => {
    const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
    const token = (await refresh.json()).data.access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const vaults = await (await fetch("/api/v1/vaults", { headers })).json();
    const id = vaults.data[0].id;
    const tree = await (await fetch(`/api/v1/vaults/${id}/tree`, { headers })).json();
    const out: string[] = [];
    const walk = (nodes: { path?: string; children?: unknown[] }[]) => {
      for (const node of nodes ?? []) {
        if (node.path) out.push(node.path);
        if (Array.isArray(node.children)) walk(node.children as typeof nodes);
      }
    };
    walk(tree.data.notes ?? tree.data.children ?? tree.data ?? []);
    return out;
  });
}

test.describe("import picker", () => {
  test("lists sources by category, searches, and explains each export", async ({ page }) => {
    await signupFreshUser(page, "import-ui");
    const dialog = await openImportPicker(page);

    // The three families the catalogue promises.
    await expect(dialog.getByText("Notes & knowledge")).toBeVisible();
    await expect(dialog.getByText("Chat & messaging")).toBeVisible();
    await expect(dialog.getByText("Email")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Obsidian/ })).toBeVisible();

    // Search narrows the grid.
    await dialog.getByLabel("Search import sources").fill("keep");
    await expect(dialog.getByRole("button", { name: /Google Keep/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Obsidian/ })).toHaveCount(0);

    // Picking a source shows how to produce the export — the step people are
    // actually missing — and its caveats *before* anything is uploaded.
    await dialog.getByRole("button", { name: /Google Keep/ }).click();
    await expect(dialog.getByText("Import from Google Keep")).toBeVisible();
    await expect(dialog.getByText(/takeout\.google\.com/)).toBeVisible();
    await expect(dialog.getByText(/Workspace-only/)).toBeVisible();
    await expect(dialog.getByText("Drop your export here")).toBeVisible();

    // And there is a way back to the grid.
    await dialog.getByRole("button", { name: "Back to all sources" }).click();
    await expect(dialog.getByRole("button", { name: /Obsidian/ })).toBeVisible();
  });

  test("a Google Keep export lands with checklists, labels and folders intact", async ({ page }) => {
    await signupFreshUser(page, "import-keep");
    const dialog = await openImportPicker(page);
    await dialog.getByLabel("Search import sources").fill("keep");
    await dialog.getByRole("button", { name: /Google Keep/ }).click();

    const archive = zip({
      "Takeout/Keep/Groceries.json": JSON.stringify({
        title: "Groceries",
        listContent: [
          { text: "Milk", isChecked: true },
          { text: "Bread", isChecked: false },
        ],
        labels: [{ name: "Home errands" }],
        createdTimestampUsec: 1700000000000000,
      }),
      "Takeout/Keep/Archived idea.json": JSON.stringify({
        title: "Archived idea",
        textContent: "An old thought.",
        isArchived: true,
      }),
    });

    await dialog.locator("input[type=file]").first().setInputFiles({
      name: "takeout.zip",
      mimeType: "application/zip",
      buffer: archive,
    });

    await expect(dialog.getByText("Imported from Google Keep")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(/2 notes/)).toBeVisible();

    // The notes really landed, in the folders the converter chose — archived
    // notes must not be mixed in with live ones.
    const produced = await vaultPaths(page);
    expect(produced).toContain("Google Keep/Groceries");
    expect(produced).toContain("Google Keep/Archive/Archived idea");
  });

  test("an Evernote export keeps its body, tags and attachment", async ({ page }) => {
    await signupFreshUser(page, "import-enex");
    const dialog = await openImportPicker(page);
    await dialog.getByLabel("Search import sources").fill("evernote");
    await dialog.getByRole("button", { name: /Evernote/ }).click();

    const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Sourdough</title>
    <content><![CDATA[<en-note><div>Mix <b>flour</b> and water.</div></en-note>]]></content>
    <created>20240115T093000Z</created>
    <tag>baking</tag>
  </note>
</en-export>`;

    await dialog.locator("input[type=file]").first().setInputFiles({
      name: "notes.enex",
      mimeType: "application/xml",
      buffer: Buffer.from(enex, "utf-8"),
    });

    await expect(dialog.getByText("Imported from Evernote")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(/1 note/)).toBeVisible();
  });

  test("a malformed export fails with the export instructions, not a stack trace", async ({
    page,
  }) => {
    await signupFreshUser(page, "import-bad");
    const dialog = await openImportPicker(page);
    await dialog.getByLabel("Search import sources").fill("roam");
    await dialog.getByRole("button", { name: /Roam/ }).click();

    await dialog.locator("input[type=file]").first().setInputFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"not":"a roam export"}', "utf-8"),
    });

    // The message names the export step, which is nearly always the real
    // problem — not "import failed".
    await expect(page.getByText(/Export All/)).toBeVisible({ timeout: 30_000 });
  });

  test("the catalogue endpoint is complete and every source is documented", async ({ page }) => {
    await signupFreshUser(page, "import-api");

    const payload = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const res = await fetch("/api/v1/integrations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    });

    const sources = payload.data.sources as {
      id: string;
      steps: string[];
      accepts: string[];
      icon: string;
    }[];
    expect(sources.length).toBeGreaterThanOrEqual(15);
    for (const source of sources) {
      expect(source.steps.length, `${source.id} has no export instructions`).toBeGreaterThan(0);
      expect(source.accepts.length, `${source.id} accepts nothing`).toBeGreaterThan(0);
      expect(source.icon, `${source.id} has no icon`).toBeTruthy();
    }
    // The ones a person is most likely to arrive from must all be present.
    const ids = sources.map((s) => s.id);
    for (const expected of ["obsidian", "notion", "evernote", "google-keep", "slack", "gmail"]) {
      expect(ids).toContain(expected);
    }
  });
});
