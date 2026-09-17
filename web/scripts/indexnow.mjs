#!/usr/bin/env node
/**
 * Submit the live sitemap's URLs to IndexNow (Bing, Yandex, Seznam, Naver,
 * Yep, Amazon — Google does not participate; it reads the sitemap).
 *
 *   INDEXNOW_KEY=… node scripts/indexnow.mjs [--site https://nodum.md]
 *                                            [--since 2026-09-01] [--dry-run]
 *
 * Run it after a deploy, against the deployed site: each engine verifies the
 * key by fetching https://<host>/<key>.txt, which the web app serves when its
 * INDEXNOW_KEY matches.
 *
 * `--since` submits only entries whose <lastmod> is on or after the date, plus
 * those with no lastmod at all (docs and hubs carry none, deliberately). IndexNow
 * asks for changed URLs, not the whole site on every run; the unfiltered form
 * is for the first submission.
 *
 * URLs are grouped by host — docs.<domain> and forum.<domain> are separate
 * IndexNow hosts, and a batch may name only one.
 */

const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10_000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const site = (arg("site") ?? process.env.SITE_URL ?? "https://nodum.md").replace(/\/+$/, "");
const since = arg("since");
const dryRun = process.argv.includes("--dry-run");
const key = process.env.INDEXNOW_KEY;

if (!key || !/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  console.error("INDEXNOW_KEY must be set: 8–128 characters of a-z, A-Z, 0-9 and '-'.");
  process.exit(1);
}

const res = await fetch(`${site}/sitemap.xml`);
if (!res.ok) {
  console.error(`sitemap fetch failed: ${res.status}`);
  process.exit(1);
}
const xml = await res.text();

const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
  loc: body.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim(),
  lastmod: body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim(),
}));

const cutoff = since ? new Date(since) : null;
const urls = entries
  .filter((e) => e.loc)
  .filter((e) => !cutoff || !e.lastmod || new Date(e.lastmod) >= cutoff)
  .map((e) => e.loc.replace(/&amp;/g, "&"));

const byHost = new Map();
for (const url of urls) {
  const host = new URL(url).host;
  if (!byHost.has(host)) byHost.set(host, []);
  byHost.get(host).push(url);
}

let failed = false;
for (const [host, list] of byHost) {
  for (let i = 0; i < list.length; i += BATCH) {
    const urlList = list.slice(i, i + BATCH);
    const body = { host, key, keyLocation: `https://${host}/${key}.txt`, urlList };
    if (dryRun) {
      console.log(`[dry-run] ${host}: ${urlList.length} URLs`);
      continue;
    }
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    // 200 and 202 are both success; 202 means the key is still being verified.
    const ok = r.status === 200 || r.status === 202;
    console.log(`${host}: ${urlList.length} URLs → ${r.status}${ok ? "" : ` ${await r.text()}`}`);
    failed ||= !ok;
  }
}

process.exit(failed ? 1 : 0);
