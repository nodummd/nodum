import { expect, test } from "@playwright/test";

import { createNoteViaApi, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("block references", () => {
  test("![[Note#^id]] embeds one block; heading embeds slice sections; links navigate", async ({
    page,
  }) => {
    await signupFreshUser(page, "blockref");

    const source = [
      "Intro paragraph that must stay out of embeds.",
      "",
      "The key insight lives here. ^key1",
      "",
      "## Section A",
      "Alpha body line.",
      "",
      "## Section B",
      "Beta body line.",
    ].join("\n");
    await createNoteViaApi(page, "Block source", source);
    await createNoteViaApi(
      page,
      "Block referrer",
      [
        "Block embed: ![[Block source#^key1]]",
        "",
        "Section embed: ![[Block source#Section A]]",
        "",
        "Jump via [[Block source#^key1]] now.",
      ].join("\n"),
    );
    await page.reload();
    await openNoteFromExplorer(page, "Block referrer");

    // Reading view: block embed shows ONLY the marked paragraph (marker stripped)
    await page.getByRole("button", { name: "Reading view" }).click();
    const embeds = page.locator(".nodum-note-embed");
    await expect(embeds.first()).toContainText("The key insight lives here.", { timeout: 15_000 });
    // the ^marker is stripped from the embedded body (title bar may show the ref)
    await expect(embeds.first().locator(".nodum-note-embed-body")).not.toContainText("^key1");
    await expect(embeds.first()).not.toContainText("Intro paragraph");

    // Heading embed shows its section only
    await expect(embeds.nth(1)).toContainText("Alpha body line.");
    await expect(embeds.nth(1)).not.toContainText("Beta body line.");

    // Block-ref wikilink navigates to the source note
    await page.getByText("Jump via").locator("..").getByText("Block source#^key1").click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Block source", {
      timeout: 10_000,
    });
    // mode is still Reading view after navigation
    await expect(page.locator(".nodum-reading").first()).toContainText(
      "The key insight lives here.",
    );
  });
});
