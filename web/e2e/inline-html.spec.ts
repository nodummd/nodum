import { expect, test, type Page } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

/**
 * The inline HTML the formatting menu emits — colour, underline, super/sub,
 * highlight — must RENDER, in live preview and in reading view, and nothing
 * outside the five-tag allowlist may ever become a real element.
 */

const EFFECTS = [
  'Colour: <span style="color:#e93147">red text</span>',
  "Underline: <u>under</u>",
  "Sup: X<sup>2</sup> Sub: H<sub>2</sub>O",
  "Bare mark: <mark>bare</mark>",
  'Styled mark: <mark style="background:#08b94e">green</mark>',
].join("\n\n");

const HOSTILE = [
  "<script>alert(1)</script>",
  '<span onerror="alert(1)">a</span>',
  '<span style="color:url(javascript:alert(1))">b</span>',
  '<span style="color:red;position:fixed">c</span>',
  "<img src=x onerror=alert(1)>",
  "<u>never closed",
].join("\n\n");

async function open(page: Page, prefix: string, content: string) {
  await signupFreshUser(page, prefix);
  await createNoteViaApi(page, "HTML note", content);
  await page.reload();
  await openNoteFromExplorer(page, "HTML note");
}

test.describe("inline HTML", () => {
  test("live preview renders the effects and hides the tags", async ({ page }) => {
    await open(page, "ihtml-live", EFFECTS);

    const spans = editorSurface(page).locator(".nodum-inline-html");
    await expect(spans).toHaveCount(6);

    // The colour is the one the author asked for, not merely "some colour".
    const colour = await spans
      .filter({ hasText: "red text" })
      .evaluate((el) => getComputedStyle(el).color);
    expect(colour).toBe("rgb(233, 49, 71)");

    const underline = await spans
      .filter({ hasText: "under" })
      .first()
      .evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(underline).toBe("underline");

    // A bare <mark> still looks highlighted — an imported Obsidian vault is
    // full of them, and they must not render as invisible text.
    const markBg = await spans
      .filter({ hasText: "bare" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(markBg).not.toBe("rgba(0, 0, 0, 0)");

    // and the source tags are not on screen
    await expect(editorSurface(page)).not.toContainText("<span style=");
    await expect(editorSurface(page)).not.toContainText("</u>");
  });

  test("reading view renders the same effects as real elements", async ({ page }) => {
    await open(page, "ihtml-read", EFFECTS);
    await page.getByRole("button", { name: "Reading view" }).click();

    const reading = page.locator(".nodum-reading");
    await expect(reading.locator(".nodum-inline-html")).toHaveCount(6);
    await expect(reading.locator("u")).toHaveText("under");
    await expect(reading.locator("sup")).toHaveText("2");
    await expect(reading.locator("mark").first()).toHaveText("bare");
    await expect(reading).not.toContainText("<u>");
  });

  test("nothing outside the allowlist becomes an element, on either surface", async ({ page }) => {
    await open(page, "ihtml-evil", HOSTILE);

    for (const surface of ["live", "reading"] as const) {
      if (surface === "reading") await page.getByRole("button", { name: "Reading view" }).click();
      const root = surface === "live" ? editorSurface(page) : page.locator(".nodum-reading");

      // No injected element exists...
      expect(await root.locator("script").count()).toBe(0);
      // (CodeMirror inserts its own zero-width cm-widgetBuffer <img>s, so count
      // only images that came from the document.)
      expect(await root.locator("img:not(.cm-widgetBuffer)").count()).toBe(0);
      expect(await root.locator("[onerror]").count()).toBe(0);
      // ...no element carries a style we refused to serialise...
      const styles = await root.locator("[style]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("style") ?? ""),
      );
      expect(styles.filter((s) => /url\(|position|expression/i.test(s))).toEqual([]);
      // ...and the rejected markup is still plainly visible as text.
      await expect(root).toContainText("<script>alert(1)</script>");
      await expect(root).toContainText("onerror");
      await expect(root).toContainText("<u>never closed");
    }
  });
});
