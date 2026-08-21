/**
 * Render one forum post's markdown — the first place strangers' markdown is
 * shown to other users, so the pipeline is deliberately narrow:
 *
 * - GFM only, no rehype-raw: raw HTML (a literal `<script>`) renders as the
 *   TEXT the author typed, exactly what react-markdown does by default.
 * - react-markdown's defaultUrlTransform stays in force (javascript: etc.
 *   never survive into href).
 * - Images become links: a remote <img> is a tracking pixel / IP leak aimed
 *   at every reader, so the reader clicks through instead.
 * - External links open in a new tab with rel guards.
 *
 * Server component — posts render into the initial HTML for crawlers.
 */

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function PostBody({ content }: { content: string }) {
  return (
    <div className="mk-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer noopener nofollow">
              {alt || "image"}
            </a>
          ),
          a: ({ href, children }) =>
            href?.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener nofollow">
                {children}
              </a>
            ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
