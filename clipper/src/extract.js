/**
 * Page extraction + HTML→Markdown.
 *
 * This runs as an injected function in the PAGE's world, so it must be
 * self-contained — no imports, no bundler. It is deliberately small rather
 * than pulling in Readability/Turndown: the goal is a clean article for a
 * note, and a compact hand-rolled walker keeps the extension dependency-free
 * and auditable. Swapping in defuddle (what Obsidian's own clipper uses, MIT)
 * is the obvious upgrade path if fidelity needs to improve.
 */

export function extractPage() {
  /** Best guess at the article container, falling back to <body>. */
  function pickRoot() {
    const candidates = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
      document.querySelector(".post-content, .entry-content, .article-body, #content"),
    ].filter(Boolean);
    // Prefer whichever candidate carries the most text.
    let best = null;
    let bestLen = 0;
    for (const el of candidates) {
      const len = (el.innerText || "").trim().length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    }
    // A tiny "article" (nav teaser, comment box) is worse than the whole page.
    return bestLen > 400 ? best : document.body;
  }

  const SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "CANVAS", "FORM",
    "NAV", "HEADER", "FOOTER", "ASIDE", "BUTTON", "SELECT", "TEXTAREA",
  ]);

  const abs = (url) => {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return url;
    }
  };

  /** Escape the characters that would otherwise become Markdown syntax. */
  const esc = (s) => s.replace(/([\\`*_[\]])/g, "\\$1");

  function inline(node) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += esc(child.nodeValue.replace(/\s+/g, " "));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (SKIP.has(tag)) continue;
      const inner = inline(child);
      if (tag === "STRONG" || tag === "B") out += inner.trim() ? `**${inner.trim()}**` : "";
      else if (tag === "EM" || tag === "I") out += inner.trim() ? `*${inner.trim()}*` : "";
      else if (tag === "CODE") out += `\`${child.textContent}\``;
      else if (tag === "A") {
        const href = child.getAttribute("href");
        out += href && inner.trim() ? `[${inner.trim()}](${abs(href)})` : inner;
      } else if (tag === "IMG") {
        const src = child.getAttribute("src");
        if (src) out += `![${esc(child.getAttribute("alt") || "")}](${abs(src)})`;
      } else if (tag === "BR") out += "\n";
      else out += inner;
    }
    return out;
  }

  function block(node, depth = 0) {
    let out = "";
    for (const child of node.children) {
      const tag = child.tagName;
      if (SKIP.has(tag)) continue;
      if (child.getAttribute("aria-hidden") === "true") continue;

      if (/^H[1-6]$/.test(tag)) {
        const text = inline(child).trim();
        if (text) out += `\n${"#".repeat(Number(tag[1]))} ${text}\n\n`;
      } else if (tag === "P") {
        const text = inline(child).trim();
        if (text) out += `${text}\n\n`;
      } else if (tag === "UL" || tag === "OL") {
        let i = 1;
        for (const li of child.children) {
          if (li.tagName !== "LI") continue;
          const bullet = tag === "OL" ? `${i++}.` : "-";
          const text = inline(li).trim();
          if (text) out += `${"  ".repeat(depth)}${bullet} ${text}\n`;
          // nested lists
          const nested = li.querySelector(":scope > ul, :scope > ol");
          if (nested) out += block(li, depth + 1);
        }
        out += "\n";
      } else if (tag === "BLOCKQUOTE") {
        const text = inline(child).trim();
        if (text) out += `${text.split("\n").map((l) => `> ${l}`).join("\n")}\n\n`;
      } else if (tag === "PRE") {
        out += `\`\`\`\n${child.textContent.trim()}\n\`\`\`\n\n`;
      } else if (tag === "IMG") {
        const src = child.getAttribute("src");
        if (src) out += `![${esc(child.getAttribute("alt") || "")}](${abs(src)})\n\n`;
      } else if (tag === "FIGURE") {
        out += block(child, depth);
      } else if (child.children.length) {
        out += block(child, depth);
      } else {
        const text = inline(child).trim();
        if (text) out += `${text}\n\n`;
      }
    }
    return out;
  }

  const root = pickRoot();
  const markdown = block(root).replace(/\n{3,}/g, "\n\n").trim();
  const selection = String(window.getSelection() || "").trim();

  return {
    url: location.href,
    title: document.title || location.hostname,
    markdown,
    selection,
  };
}
