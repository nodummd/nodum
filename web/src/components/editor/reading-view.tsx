"use client";

/** Reading view — rendered markdown (gfm + math + callouts + wikilinks + embeds). */

import { Children, isValidElement, useMemo, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CalloutBox } from "./callout-box";
import { MermaidDiagram, ShikiCodeBlock } from "./code-block";
import { AttachmentImage, NoteEmbed } from "./embeds";
import { isImageTarget } from "@/lib/editor/markdown-extensions";
import { remarkCallouts } from "@/lib/editor/remark-callouts";

import "katex/dist/katex.min.css";

interface ReadingViewProps {
  content: string;
  vaultId: string;
  onNavigate: (target: string) => void;
  /** Transclusion nesting depth (embeds render embeds up to depth 2). */
  depth?: number;
}

/**
 * Convert [[wikilinks]] to markdown links with a nodum: scheme we intercept.
 * Code fences and inline code spans are left untouched — a [[link]] inside
 * code is literal text, not a link.
 */
function preprocessWikilinks(md: string): string {
  const CODE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;
  return md
    .split(CODE_SPLIT)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk; // code segment — leave verbatim
      return chunk.replace(/(!?)\[\[([^\][\n]+?)\]\]/g, (_m, embed: string, inner: string) => {
        const [body, alias] = inner.split("|");
        const target = body.split("#")[0].trim();
        const label = (alias ?? body).trim();
        if (embed === "!") return `![${label}](nodum-embed:${encodeURIComponent(target)})`;
        return `[${label}](nodum:${encodeURIComponent(target)})`;
      });
    })
    .join("");
}

export function ReadingView({ content, vaultId, onNavigate, depth = 0 }: ReadingViewProps) {
  const processed = useMemo(() => preprocessWikilinks(content), [content]);

  return (
    <div className="nodum-reading">
      <ReactMarkdown
        remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath, remarkCallouts]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // @ts-expect-error -- custom hast node emitted by remarkCallouts
          callout: CalloutBox,
          pre({ children, ...props }) {
            // Fenced code arrives as <pre><code class="language-x">…</code></pre>;
            // route it through shiki (or mermaid for ```mermaid fences).
            const only = Children.count(children) === 1 ? Children.only(children) : null;
            if (isValidElement(only) && only.type === "code") {
              const codeEl = only as ReactElement<{ className?: string; children?: unknown }>;
              const lang = /language-(\S+)/.exec(codeEl.props.className ?? "")?.[1] ?? "";
              const code = String(codeEl.props.children ?? "").replace(/\n$/, "");
              if (lang.toLowerCase() === "mermaid") return <MermaidDiagram code={code} />;
              return <ShikiCodeBlock code={code} lang={lang} />;
            }
            return <pre {...props}>{children}</pre>;
          },
          a({ href, children, ...props }) {
            if (href?.startsWith("nodum:")) {
              const target = decodeURIComponent(href.slice("nodum:".length));
              return (
                <a
                  {...props}
                  href="#"
                  className="internal-link"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(target);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a {...props} href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img({ src, alt, ...props }) {
            if (typeof src === "string" && src.startsWith("nodum-embed:")) {
              const target = decodeURIComponent(src.slice("nodum-embed:".length));
              if (isImageTarget(target)) {
                const width = alt && /^\d+$/.test(alt) ? Number(alt) : null;
                return <AttachmentImage vaultId={vaultId} filename={target} width={width} />;
              }
              return (
                <NoteEmbed
                  vaultId={vaultId}
                  target={target}
                  onNavigate={onNavigate}
                  depth={depth}
                  renderContent={(embedContent, nextDepth) => (
                    <ReadingView
                      content={embedContent}
                      vaultId={vaultId}
                      onNavigate={onNavigate}
                      depth={nextDepth}
                    />
                  )}
                />
              );
            }
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={alt ?? ""} {...props} />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
