"use client";

/** Reading view — rendered markdown (gfm + math + wikilinks + tags). */

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";

interface ReadingViewProps {
  content: string;
  onNavigate: (target: string) => void;
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

export function ReadingView({ content, onNavigate }: ReadingViewProps) {
  const processed = useMemo(() => preprocessWikilinks(content), [content]);

  return (
    <div className="nodum-reading">
      <ReactMarkdown
        remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
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
              return (
                <span className="nodum-embed-placeholder">
                  ![[{target}]] <em>(embed)</em>
                </span>
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
