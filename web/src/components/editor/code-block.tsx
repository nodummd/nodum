"use client";

/** Reading-view code blocks — shiki syntax highlighting + mermaid diagrams. */

import { useEffect, useState } from "react";

import { renderMermaidSvg } from "@/lib/editor/mermaid";
import { cachedHighlight, highlightToHtml } from "@/lib/editor/shiki";

export function ShikiCodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(() => cachedHighlight(code, lang));

  useEffect(() => {
    let cancelled = false;
    void highlightToHtml(code, lang).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    return <div className="nodum-codeblock" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className="nodum-codeblock">
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderMermaidSvg(code)
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="nodum-mermaid-error">
        <pre>
          <code>{code}</code>
        </pre>
        <p>Mermaid: {error}</p>
      </div>
    );
  }
  if (!svg) return <div className="nodum-mermaid" aria-busy="true" />;
  return <div className="nodum-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
