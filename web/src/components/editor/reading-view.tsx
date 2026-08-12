"use client";

/** Reading view — rendered markdown (gfm + math + callouts + wikilinks + embeds). */

import { Children, isValidElement, useMemo, type ReactElement } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
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
 * Convert [[wikilinks]] to markdown links with a nodum: scheme we intercept,
 * and strip %%comments%% (Obsidian hides them when reading; an unclosed %%
 * comments out the rest of the chunk). Code fences and inline code spans are
 * left untouched — a [[link]] or %% inside code is literal text.
 */
function preprocessWikilinks(md: string): string {
  const CODE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;
  return md
    .split(CODE_SPLIT)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk; // code segment — leave verbatim
      chunk = chunk.replace(/%%[\s\S]*?%%/g, "").replace(/%%[\s\S]*$/, "");
      return chunk.replace(/(!?)\[\[([^\][\n]+?)\]\]/g, (_m, embed: string, inner: string) => {
        const [body, alias] = inner.split("|");
        const target = body.split("#")[0].trim();
        // #Heading / #^block-id fragment rides along for slicing
        const fragment = body.includes("#") ? body.slice(body.indexOf("#") + 1).trim() : "";
        const label = (alias ?? body).trim();
        const ref = fragment ? `${target}#${fragment}` : target;
        if (embed === "!") return `![${label}](nodum-embed:${encodeURIComponent(ref)})`;
        return `[${label}](nodum:${encodeURIComponent(ref)})`;
      });
    })
    .join("");
}

/** "Note#^id" → ["Note", "^id"]; "Note" → ["Note", null]. */
function splitRef(ref: string): [string, string | null] {
  const hash = ref.indexOf("#");
  if (hash === -1) return [ref, null];
  return [ref.slice(0, hash).trim(), ref.slice(hash + 1).trim() || null];
}

export function ReadingView({ content, vaultId, onNavigate, depth = 0 }: ReadingViewProps) {
  const processed = useMemo(() => preprocessWikilinks(content), [content]);

  return (
    <div className="nodum-reading">
      <ReactMarkdown
        remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath, remarkCallouts]}
        rehypePlugins={[rehypeKatex]}
        // default transform strips unknown protocols — ours carry embed refs
        urlTransform={(url) =>
          url.startsWith("nodum:") || url.startsWith("nodum-embed:") ? url : defaultUrlTransform(url)
        }
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
              const ref = decodeURIComponent(href.slice("nodum:".length));
              const [target, fragment] = splitRef(ref);
              return (
                <a
                  {...props}
                  href="#"
                  className="internal-link"
                  data-wikilink-target={target}
                  data-wikilink-fragment={fragment ?? undefined}
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
              const ref = decodeURIComponent(src.slice("nodum-embed:".length));
              const [target, fragment] = splitRef(ref);
              if (isImageTarget(target)) {
                const width = alt && /^\d+$/.test(alt) ? Number(alt) : null;
                return <AttachmentImage vaultId={vaultId} filename={target} width={width} />;
              }
              return (
                <NoteEmbed
                  vaultId={vaultId}
                  target={target}
                  fragment={fragment}
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
