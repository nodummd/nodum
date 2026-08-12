/**
 * Custom Lezer markdown nodes for Obsidian syntax:
 *   WikiLink  [[Note]] / [[Note|alias]] / [[Note#Heading]]
 *   Embed     ![[Note]] / ![[image.png]]
 *   Hashtag   #tag, #nested/tag (must contain a non-digit)
 *   HighlightInline  ==marked text==
 *
 * Pattern follows SilverBullet's parser.ts (MIT): parseInline extensions
 * that emit first-class syntax-tree nodes the live preview can decorate.
 */

import { tags as t } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const CH = {
  bang: 33,
  hash: 35,
  eq: 61,
  openBracket: 91,
  closeBracket: 93,
  newline: 10,
};

function scanWikiLinkEnd(cx: InlineContext, start: number): number {
  for (let i = start; i < cx.end - 1; i++) {
    const ch = cx.char(i);
    if (ch === CH.newline) return -1;
    if (ch === CH.closeBracket && cx.char(i + 1) === CH.closeBracket) return i + 2;
  }
  return -1;
}

export const WikiLinkExtension: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: t.link },
    { name: "Embed", style: t.link },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        // ![[Embed]]
        if (next === CH.bang && cx.char(pos + 1) === CH.openBracket && cx.char(pos + 2) === CH.openBracket) {
          const end = scanWikiLinkEnd(cx, pos + 3);
          return end < 0 ? -1 : cx.addElement(cx.elt("Embed", pos, end));
        }
        // [[WikiLink]]
        if (next === CH.openBracket && cx.char(pos + 1) === CH.openBracket) {
          const end = scanWikiLinkEnd(cx, pos + 2);
          return end < 0 ? -1 : cx.addElement(cx.elt("WikiLink", pos, end));
        }
        return -1;
      },
    },
  ],
};

function isTagChar(ch: number): boolean {
  return (
    (ch >= 48 && ch <= 57) || // 0-9
    (ch >= 65 && ch <= 90) || // A-Z
    (ch >= 97 && ch <= 122) || // a-z
    ch === 95 || // _
    ch === 45 || // -
    ch === 47 || // /
    ch > 127 // unicode letters
  );
}

export const HashtagExtension: MarkdownConfig = {
  defineNodes: [{ name: "Hashtag", style: t.labelName }],
  parseInline: [
    {
      name: "Hashtag",
      parse(cx, next, pos) {
        if (next !== CH.hash) return -1;
        const before = pos > cx.offset ? cx.char(pos - 1) : CH.newline;
        if (isTagChar(before) || before === CH.hash) return -1;

        let i = pos + 1;
        let hasNonDigit = false;
        while (i < cx.end && isTagChar(cx.char(i))) {
          const ch = cx.char(i);
          if (!(ch >= 48 && ch <= 57) && ch !== 47) hasNonDigit = true;
          i++;
        }
        if (i === pos + 1 || !hasNonDigit) return -1; // empty or numeric-only (#1984)
        return cx.addElement(cx.elt("Hashtag", pos, i));
      },
    },
  ],
};

const CH_DOLLAR = 36;

export const InlineMathExtension: MarkdownConfig = {
  defineNodes: [{ name: "InlineMath", style: t.special(t.number) }],
  parseInline: [
    {
      name: "InlineMath",
      before: "Emphasis",
      parse(cx, next, pos) {
        // $formula$ — single dollar, no leading/trailing space inside,
        // not $$ (block math is handled by the live-preview line scanner)
        if (next !== CH_DOLLAR || cx.char(pos + 1) === CH_DOLLAR) return -1;
        for (let i = pos + 1; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === CH.newline) return -1;
          if (ch === CH_DOLLAR) {
            if (i === pos + 1) return -1; // empty $$
            return cx.addElement(cx.elt("InlineMath", pos, i + 1));
          }
        }
        return -1;
      },
    },
  ],
};

export const HighlightExtension: MarkdownConfig = {
  defineNodes: [{ name: "HighlightInline", style: t.special(t.string) }],
  parseInline: [
    {
      name: "HighlightInline",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== CH.eq || cx.char(pos + 1) !== CH.eq) return -1;
        for (let i = pos + 2; i < cx.end - 1; i++) {
          const ch = cx.char(i);
          if (ch === CH.newline) return -1;
          if (ch === CH.eq && cx.char(i + 1) === CH.eq && i > pos + 2) {
            return cx.addElement(cx.elt("HighlightInline", pos, i + 2));
          }
        }
        return -1;
      },
    },
  ],
};

export const nodumMarkdownExtensions = [
  WikiLinkExtension,
  HashtagExtension,
  HighlightExtension,
  InlineMathExtension,
];

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/** Is a wikilink/embed target an image attachment filename? */
export function isImageTarget(target: string): boolean {
  return IMAGE_EXT_RE.test(target.trim());
}

/** Parse the inner text of a [[wikilink]] into its parts. */
export function parseWikiLinkText(inner: string): {
  target: string;
  heading: string | null;
  alias: string | null;
} {
  let body = inner;
  let alias: string | null = null;
  const pipe = body.indexOf("|");
  if (pipe >= 0) {
    alias = body.slice(pipe + 1).trim() || null;
    body = body.slice(0, pipe);
  }
  let heading: string | null = null;
  const hash = body.indexOf("#");
  if (hash >= 0) {
    heading = body.slice(hash + 1).trim() || null;
    body = body.slice(0, hash);
  }
  return { target: body.trim(), heading, alias };
}
