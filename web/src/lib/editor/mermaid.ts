/**
 * Shared mermaid loader — lazy singleton (mermaid is ~1.5MB, only fetched when
 * a ```mermaid fence is on screen). Never bundle rehype-mermaid (research
 * decision) — diagrams render client-side into whatever container asks.
 */

import type { Mermaid } from "mermaid";

let mermaidPromise: Promise<Mermaid> | null = null;
let renderSeq = 0;

function getMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      themeVariables: {
        darkMode: true,
        background: "#1e1e1e",
        primaryColor: "#363636",
        primaryTextColor: "#dadada",
        lineColor: "#7a7a7a",
        fontFamily: "inherit",
      },
    });
    return m.default;
  });
  return mermaidPromise;
}

/** Render a mermaid definition to SVG markup. Throws on parse errors. */
export async function renderMermaidSvg(code: string): Promise<string> {
  const mermaid = await getMermaid();
  const id = `nodum-mermaid-${++renderSeq}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // mermaid can leave its scratch element behind on parse failure
    document.getElementById(`d${id}`)?.remove();
  }
}
