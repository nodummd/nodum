import { expect, test, type Page } from "@playwright/test";

import { signupFreshUser } from "./helpers";

/** Label level-of-detail.
 *
 *  The graph names what there is room to name. Names are drawn most-connected
 *  first, each one taking the screen space it occupies, and a name that would
 *  land on space already taken is not drawn — so zooming out quiets the graph
 *  down to its hubs and then to nothing, and zooming in hands the space back
 *  until everything is named. Search is the exemption: what you went looking
 *  for is named at any zoom, even where the rest have gone silent.
 *
 *  What is assertable from the DOM is the overlay: one absolutely positioned
 *  div per name, with the render loop's decision in its inline opacity. */

interface DrawnLabel {
  text: string;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The names actually on the glass — inline opacity is the render loop's own
 *  verdict, so this is what a reader sees, not what exists in the DOM. */
async function drawnLabels(page: Page): Promise<DrawnLabel[]> {
  return page.locator(".nodum-graph-label").evaluateAll((els) =>
    els
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: el.textContent ?? "",
          opacity: parseFloat((el as HTMLElement).style.opacity || "0"),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((label) => label.opacity > 0),
  );
}

/** Open the graph and wait until it has stopped moving.
 *
 *  Settling matters more than it looks: the camera is fitted to the layout once
 *  the simulation ends (or, failing that, on a timer), and a fit that lands
 *  after a test has zoomed would quietly undo it. Waiting for a name to hold
 *  still waits for both. */
async function openSettledGraph(page: Page) {
  // The explorer is the sign that the workspace is live; pressing the shortcut
  // into a page that is still hydrating does nothing at all.
  await expect(page.getByRole("tree", { name: "File explorer" })).toBeVisible({ timeout: 20_000 });
  const opened = Date.now();
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    expect((await drawnLabels(page)).length).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000 });

  const anchor = page.locator(".nodum-graph-label").first();
  let last = await anchor.boundingBox();
  await expect(async () => {
    await page.waitForTimeout(700);
    const now = await anchor.boundingBox();
    const moved = Math.hypot((now?.x ?? 0) - (last?.x ?? 0), (now?.y ?? 0) - (last?.y ?? 0));
    last = now;
    expect(moved).toBeLessThan(2);
  }).toPass({ timeout: 30_000 });
  // The fit has a 7s fallback of its own, and it lands after the layout has
  // stopped moving. Outsit it, or it re-frames the view mid-test.
  await page.waitForTimeout(Math.max(0, 9_000 - (Date.now() - opened)));
}

/** Wheel over the middle of the canvas, then take the pointer off it — resting
 *  on a node would highlight it, and a highlight is exactly what these tests
 *  are measuring the absence of. */
async function zoom(page: Page, ticks: number, delta: number) {
  const box = await page.locator("main canvas").first().boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < ticks; i++) await page.mouse.wheel(0, delta);
  await page.mouse.move(2, 2);
}

test.describe("graph label level-of-detail", () => {
  test("zooming out quiets the names; search still speaks", async ({ page }) => {
    // Signup, a layout that has to settle, and several zoom round-trips: this
    // one is honestly slow, and the default budget makes it flaky rather than
    // failing.
    test.setTimeout(120_000);
    await signupFreshUser(page, "graphlod");
    await openSettledGraph(page);
    // Nothing may be breathing: the note you are working in is named whatever
    // the zoom, by design, and would mask the effect under test.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator(".nodum-graph-label[data-pulse]")).toHaveCount(0);

    // Keep pulling back until the names go quiet: the wheel is retried inside
    // the assertion so a late camera fit costs a round, not the test.
    let ticksOut = 0;
    await expect(async () => {
      await zoom(page, 6, 240);
      ticksOut += 6;
      expect(await drawnLabels(page)).toEqual([]);
    }).toPass({ timeout: 20_000 });

    // The exemption: at that same zoom, a search names its matches and only
    // its matches.
    await page.getByRole("button", { name: "Search graph" }).click();
    await page.getByLabel("Search graph").fill("Welcome to Nodum");
    await expect(async () => {
      const lit = await drawnLabels(page);
      expect(lit.map((label) => label.text)).toEqual(["Welcome to Nodum"]);
      expect(lit[0].opacity).toBe(1);
    }).toPass({ timeout: 15_000 });

    // Clearing it puts the graph back to quiet.
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(async () => {
      expect(await drawnLabels(page)).toEqual([]);
    }).toPass({ timeout: 15_000 });

    // And coming back in names things again. Exactly as far as we went out, and
    // about the same point: the wheel zooms about the pointer, so anything else
    // walks the graph off the side of the canvas instead of returning to it.
    await zoom(page, ticksOut, -240);
    await expect(async () => {
      expect((await drawnLabels(page)).length).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
  });

  test("what is drawn never overlaps, however crowded the graph", async ({ page }) => {
    test.setTimeout(120_000);
    await signupFreshUser(page, "graphcrowd");
    // Forty notes with long titles, each linking the next: a dense middle where
    // every name would sit on top of its neighbours if they were all drawn.
    await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST" });
      const token = (await refresh.json()).data.access_token;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const vaults = await (await fetch("/api/v1/vaults", { headers })).json();
      const vaultId = vaults.data[0].id;
      for (let i = 0; i < 40; i++) {
        await fetch(`/api/v1/vaults/${vaultId}/notes`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: `A deliberately long crowded note title ${i}`,
            content: `[[A deliberately long crowded note title ${(i + 1) % 40}]]`,
          }),
        });
      }
    });
    await page.reload();
    await openSettledGraph(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(2, 2);

    await expect(async () => {
      const lit = await drawnLabels(page);
      // Some names, not all of them: forty long titles cannot fit at the fit
      // view, and the point of the exercise is that the graph knows that.
      expect(lit.length).toBeGreaterThan(0);
      expect(lit.length).toBeLessThan(40);
      const collisions = lit.flatMap((a, i) =>
        lit.slice(i + 1).flatMap((b) =>
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
            ? [`${a.text} × ${b.text}`]
            : [],
        ),
      );
      expect(collisions).toEqual([]);
    }).toPass({ timeout: 20_000 });
  });
});
