/**
 * The IndexNow key file, served at /{key}.txt through a rewrite in
 * next.config.ts (a route segment cannot contain the `.txt`).
 *
 * IndexNow lets a site tell Bing — and through it Yandex, Seznam, Naver, Yep
 * and Amazon — that a URL changed, instead of waiting to be recrawled. Bing's
 * index is also what Copilot and a good share of ChatGPT search are grounded
 * on, so this is the fastest path from "published" to "citable" outside
 * Google. The engine proves the submission is ours by fetching this file from
 * the same host and finding the key in it.
 *
 * The key is public by design, but it is configuration, not code: a fork must
 * not answer for this deployment's key. INDEXNOW_KEY is read at request time;
 * any other name, or no key configured, is a 404. `scripts/indexnow.mjs`
 * submits the URLs.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const configured = process.env.INDEXNOW_KEY;
  if (!configured || key !== configured) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(configured, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
