"use client";

/** The forum's composer input: a textarea with Write | Preview tabs. The
 *  preview runs the same narrow pipeline as the rendered post, so what you
 *  see is byte-for-byte what readers get. */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownBox({
  value,
  onChange,
  placeholder,
  minRows = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="mk-card overflow-hidden">
      <div className="flex gap-1 border-b border-white/10 px-2 pt-2">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-[0.8rem] capitalize ${
              tab === t ? "bg-white/10 font-medium" : "opacity-60 hover:opacity-90"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "write" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={minRows}
          className="w-full resize-y bg-transparent px-3 py-2 font-mono text-[0.9rem] outline-none"
          aria-label="Markdown"
        />
      ) : (
        <div className="mk-prose min-h-24 px-3 py-2">
          {value.trim() ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt }) => (
                  <a href={typeof src === "string" ? src : undefined}>{alt || "image"}</a>
                ),
              }}
            >
              {value}
            </ReactMarkdown>
          ) : (
            <p className="opacity-50">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
