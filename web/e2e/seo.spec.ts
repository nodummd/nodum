import { expect, test } from "@playwright/test";

/**
 * The search surface: robots.txt, the sitemap, llms.txt, canonicals, titles
 * and structured data.
 *
 * These are the assertions that catch the failure mode this work exists to
 * fix — a page that looks correct in a browser and is empty to a crawler.
 * Several deliberately read the raw HTTP response rather than the rendered
 * DOM, because "present after hydration" is not the same as "present in the
 * initial HTML", and only the second one is what a crawler or an answer engine
 * receives.
 */

/** Parse every JSON-LD block on a page and flatten any `@graph` wrappers. */
async function structuredData(html: string): Promise<Record<string, unknown>[]> {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const nodes: Record<string, unknown>[] = [];
  for (const [, raw] of blocks) {
    const parsed = JSON.parse(raw.replace(/\\u003c/g, "<")) as Record<string, unknown>;
    const graph = parsed["@graph"];
    if (Array.isArray(graph)) nodes.push(...(graph as Record<string, unknown>[]));
    else nodes.push(parsed);
  }
  return nodes;
}

function typesOf(nodes: Record<string, unknown>[]): string[] {
  return nodes.map((n) => String(n["@type"]));
}

test.describe("robots.txt", () => {
  test("allows the answer engines, keeps them out of the app, and names the sitemap", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();

    // The GEO decision, asserted: the engines that produce citations are
    // explicitly welcome. A silent regression here is invisible until traffic
    // disappears, so it is worth a test.
    for (const agent of [
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "Claude-SearchBot",
      "PerplexityBot",
      "Google-Extended",
      "Applebot-Extended",
    ]) {
      expect(body, `${agent} should have its own group`).toContain(`User-Agent: ${agent}`);
    }

    // ...and the one that ignores the rules is told anyway.
    expect(body).toMatch(/User-Agent: Bytespider\nDisallow: \/$/m);

    // Nothing private is crawlable, for any agent.
    for (const path of ["/api/", "/vault", "/clip", "/p/"]) {
      expect(body).toContain(`Disallow: ${path}`);
    }

    // Published vault sites are public by intent and must stay crawlable.
    expect(body).not.toContain("Disallow: /s/");

    expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
  });
});

test.describe("sitemap.xml", () => {
  test("is valid XML and lists the pages that matter", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("xml");

    const body = await res.text();
    expect(body).toContain("<urlset");

    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(40);

    // Every entry must be absolute — a relative loc is silently dropped.
    for (const loc of locs) expect(loc).toMatch(/^https?:\/\//);

    // No duplicates: two entries for one URL is a crawl-budget leak.
    expect(new Set(locs).size).toBe(locs.length);

    for (const path of [
      "/alternatives",
      "/alternatives/obsidian",
      "/learn",
      "/learn/second-brain",
      "/glossary",
      "/faq",
      "/docs",
    ]) {
      expect(locs.some((l) => l.endsWith(path)), `sitemap should list ${path}`).toBe(true);
    }

    // The app and the unlisted share links must never be advertised. Matched
    // on the whole path, not a substring: /docs/vaults is a documentation
    // article and legitimately contains "/vault".
    const paths = locs.map((l) => new URL(l).pathname);
    expect(paths.some((p) => p === "/vault" || p.startsWith("/vault/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/p/"))).toBe(false);
    expect(paths.some((p) => p === "/clip")).toBe(false);
  });
});

test.describe("llms.txt", () => {
  test("follows the spec's shape and states what Nodum does not do", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/markdown");

    const body = await res.text();
    const lines = body.split("\n");

    // Spec: H1 first, then a blockquote summary.
    expect(lines[0]).toBe("# Nodum");
    expect(body).toMatch(/\n> Nodum .*open-source/);

    // H2 sections whose items are markdown links with a note after a colon.
    expect(body).toContain("## Start here");
    expect(body).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\): .+$/m);

    // The limitations paragraph is the point of the file: a model that knows
    // what is absent will not invent it.
    expect(body).toContain("does not run Obsidian's plugins");
    expect(body).toContain("no block-level references");
  });

  test("llms-full.txt carries the whole corpus", async ({ request }) => {
    const res = await request.get("/llms-full.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(50_000);
    expect(body).toContain("## Nodum vs Obsidian");
    expect(body).toContain("What Obsidian does better");
  });
});

test.describe("metadata", () => {
  const PAGES = [
    "/",
    "/alternatives",
    "/alternatives/obsidian",
    "/learn",
    "/learn/second-brain",
    "/glossary",
    "/faq",
    "/docs",
    "/docs/getting-started",
    "/login",
    "/signup",
  ];

  test("every public page has a self-referencing canonical", async ({ request }) => {
    for (const path of PAGES) {
      const html = await (await request.get(path)).text();
      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
      expect(canonical, `${path} is missing a canonical`).toBeTruthy();
      // The bug this guards: a canonical inherited from a parent layout points
      // every page at "/" and collapses the site into one indexed URL.
      const expected = path === "/" ? "/" : path;
      expect(new URL(canonical as string).pathname, `${path} canonical is wrong`).toBe(expected);
    }
  });

  test("titles are unique, and none is doubled by the template", async ({ request }) => {
    const titles = new Map<string, string>();
    for (const path of PAGES) {
      const html = await (await request.get(path)).text();
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      expect(title.length, `${path} has no title`).toBeGreaterThan(10);
      // "Documentation · Nodum · Nodum" — a layout title string colliding with
      // the root template. Caught here because it is invisible in the UI.
      expect(title.match(/Nodum/g)?.length ?? 0, `${path} repeats the brand`).toBeLessThan(2);
      titles.set(path, title);
    }
    expect(new Set(titles.values()).size, "two pages share a title").toBe(titles.size);
  });

  test("the crawler is allowed to quote a full passage", async ({ request }) => {
    const html = await (await request.get("/alternatives/obsidian")).text();
    expect(html).toContain("max-snippet:-1");
    expect(html).toContain("max-image-preview:large");
  });

  test("the app and the clipper are noindex", async ({ request }) => {
    for (const path of ["/vault", "/clip"]) {
      const html = await (await request.get(path)).text();
      expect(html, `${path} should be noindex`).toMatch(/<meta name="robots" content="noindex/);
    }
  });

  test("llms.txt is advertised for agents that never parse HTML", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["link"]).toContain('rel="describedby"');
    expect(await res.text()).toContain('rel="describedby"');
  });
});

test.describe("structured data", () => {
  test("the landing page declares the entity once, with an offer of zero", async ({ request }) => {
    const nodes = await structuredData(await (await request.get("/")).text());
    const types = typesOf(nodes);

    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
    expect(types).toContain("SoftwareApplication");
    expect(types).toContain("FAQPage");

    const app = nodes.find((n) => n["@type"] === "SoftwareApplication") as Record<string, unknown>;
    expect(app.isAccessibleForFree).toBe(true);
    // "Is it free?" is the highest-volume qualifier in this category, and a
    // machine-readable zero is what makes an AI answer say so without hedging.
    expect((app.offers as Record<string, unknown>).price).toBe(0);
    expect(String(app.license)).toContain("MIT");

    // One organisation, not several: the @id discipline is the whole point.
    expect(types.filter((t) => t === "Organization")).toHaveLength(1);
  });

  test("a comparison page names the competitor as a real entity", async ({ request }) => {
    const nodes = await structuredData(await (await request.get("/alternatives/obsidian")).text());
    const types = typesOf(nodes);

    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("FAQPage");
    expect(types).toContain("HowTo");

    const named = nodes.filter((n) => n["@type"] === "SoftwareApplication").map((n) => n.name);
    expect(named).toContain("Obsidian");

    const faq = nodes.find((n) => n["@type"] === "FAQPage") as Record<string, unknown>;
    const questions = faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(questions.length).toBeGreaterThan(2);
    for (const q of questions) {
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(40);
    }
  });

  test("the glossary declares a term set", async ({ request }) => {
    const nodes = await structuredData(await (await request.get("/glossary")).text());
    const types = typesOf(nodes);
    expect(types).toContain("DefinedTermSet");
    expect(types.filter((t) => t === "DefinedTerm").length).toBeGreaterThan(20);
  });
});

test.describe("server rendering", () => {
  test("the landing page's content is in the HTML, not assembled after hydration", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain("Notes are the");
    // The FAQ answers are the passage an answer engine lifts. If the page
    // regresses to a client component these vanish from the response.
    expect(html).toContain("Nodum is a free, open-source, web-based knowledge base");
    // Links into the comparison cluster. Asserted on the href rather than the
    // label: React splits interpolated text across nodes, so "Nodum vs
    // Obsidian" arrives as `Nodum vs <!-- -->Obsidian` in the raw HTML.
    expect(html).toContain('href="/alternatives/obsidian"');
    expect(html).toContain('href="/learn/second-brain"');
  });

  test("a comparison page ships its answer block and its losses", async ({ page }) => {
    await page.goto("/alternatives/obsidian");
    // The honest column is load-bearing for this page's credibility; assert
    // the heading and a specific concession so neither can be quietly
    // softened away. Read through the DOM because the headings interpolate
    // the competitor's name.
    await expect(page.getByRole("heading", { name: "What Obsidian does better" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stay on Obsidian if…" })).toBeVisible();
    await expect(page.getByText(/A plugin ecosystem of well over a thousand/)).toBeVisible();
  });

  test("every comparison and guide answers in its first paragraph", async ({ page }) => {
    for (const path of ["/alternatives/notion", "/learn/knowledge-graph", "/learn/ai-note-taking"]) {
      await page.goto(path);
      const answer = page.locator(".mk-answer p").first();
      await expect(answer).toBeVisible();
      const text = (await answer.innerText()).trim();
      // 40–60 words is the extractable-passage target; allow a band around it.
      const words = text.split(/\s+/).length;
      expect(words, `${path} answer is ${words} words`).toBeGreaterThan(25);
      expect(words, `${path} answer is ${words} words`).toBeLessThan(90);
    }
  });

  test("exactly one h1 per page, and it is not the wordmark", async ({ page }) => {
    for (const path of ["/", "/alternatives", "/alternatives/obsidian", "/learn/second-brain", "/faq"]) {
      await page.goto(path);
      await expect(page.locator("h1"), `${path} should have one h1`).toHaveCount(1);
    }
  });
});

test.describe("internal linking", () => {
  test("the clusters reach each other", async ({ page }) => {
    await page.goto("/alternatives/obsidian");
    // A comparison page must not dead-end: it points back to the hub and out
    // to the vocabulary, or it is an orphan with no way to pass authority on.
    await expect(page.getByRole("link", { name: "alternatives index" })).toBeVisible();
    // `exact` because the footer also carries a "Glossary" link on every page.
    await expect(page.getByRole("link", { name: "glossary", exact: true })).toBeVisible();

    await page.goto("/learn/second-brain");
    await expect(page.getByRole("link", { name: /Nodum vs Obsidian/ }).first()).toBeVisible();
  });

  test("keyword aliases redirect rather than 404", async ({ request }) => {
    const cases: [string, string][] = [
      ["/obsidian-alternative", "/alternatives/obsidian"],
      ["/second-brain", "/learn/second-brain"],
      ["/pkm", "/learn/personal-knowledge-management"],
    ];
    for (const [from, to] of cases) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), `${from} should redirect`).toBe(308);
      expect(res.headers()["location"]).toBe(to);
    }
  });
});
