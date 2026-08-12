/**
 * KaTeX rendering with a shared memo cache — typing near a math region must
 * never re-render other formulas (docs/research/DECISIONS.md risk list).
 */

import katex from "katex";

const cache = new Map<string, string>();
const CACHE_CAP = 500;

export function renderMathHTML(source: string, displayMode: boolean): string {
  const key = `${displayMode ? "D" : "I"}:${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let html: string;
  try {
    html = katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    html = `<span class="cm-math-error">${source}</span>`;
  }

  if (cache.size >= CACHE_CAP) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, html);
  return html;
}
