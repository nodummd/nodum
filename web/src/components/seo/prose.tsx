import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a markdown string into the marketing skin's prose styles.
 *
 * Content in `src/content/seo/` is written as markdown strings rather than
 * JSX so the same text can be served three ways: as HTML here, as plain
 * markdown to `/llms.txt`, and as a description in structured data. One
 * source, three renderings — which is also why the content files contain no
 * markup of their own.
 *
 * Server component by construction: no `"use client"`, so the rendered HTML
 * is in the initial response, which is the only version a crawler that does
 * not execute JavaScript will ever see.
 */
export function Prose({
  children,
  className = "mk-prose",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Internal links go through next/link so a click is a client
          // navigation; external ones open away and drop the referrer chain.
          a: ({ href, children: inner }) =>
            href?.startsWith("/") ? (
              <Link href={href}>{inner}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {inner}
              </a>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Markdown rendered inline — no wrapping paragraph. For list items. */
export function ProseInline({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: inner }) => <>{inner}</>,
        a: ({ href, children: inner }) =>
          href?.startsWith("/") ? (
            <Link href={href}>{inner}</Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {inner}
            </a>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
