import { expect, test } from "@playwright/test";

import { createNoteViaApi, editorSurface, openNoteFromExplorer, signupFreshUser } from "./helpers";

test.describe("code blocks", () => {
  test("shiki highlights fences and mermaid renders diagrams in both views", async ({ page }) => {
    await signupFreshUser(page, "code-e2e");

    const content = [
      "Some intro text.",
      "",
      "```js",
      'const greeting = "hello";',
      "function shout(s) {",
      "  return s.toUpperCase();",
      "}",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  A[Start] --> B[Finish]",
      "```",
      "",
      "End marker.",
    ].join("\n");
    await createNoteViaApi(page, "Code zoo", content);
    await page.reload();
    await openNoteFromExplorer(page, "Code zoo");

    // Live preview: cursor at doc end → both fences render as widgets
    await editorSurface(page).click();
    await page.keyboard.press("ControlOrMeta+ArrowDown");

    const codeWidget = page.locator(".cm-code-widget.is-highlighted");
    await expect(codeWidget).toBeVisible({ timeout: 20_000 });
    // Shiki emits per-token spans with inline colors
    await expect(
      codeWidget.locator("pre.shiki span[style*='color']").first(),
    ).toBeVisible();
    await expect(codeWidget.locator(".cm-code-lang")).toHaveText("js");
    await expect(page.locator(".cm-mermaid-widget svg")).toBeVisible({ timeout: 20_000 });

    // Clicking the widget reveals raw fence text (reveal-on-cursor)
    await codeWidget.click();
    await expect(editorSurface(page)).toContainText('const greeting = "hello";');

    // Reading view: same content through react-markdown
    await page.getByRole("button", { name: "Reading view" }).click();
    await expect(
      page.locator(".nodum-codeblock pre.shiki span[style*='color']").first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".nodum-mermaid svg")).toBeVisible({ timeout: 20_000 });
  });
});
