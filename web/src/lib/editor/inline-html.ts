/**
 * The small, closed set of inline HTML nodum understands.
 *
 * Markdown cannot express underline, super/subscript, or coloured text, so the
 * formatting menu writes inline HTML for those — the same thing Obsidian does.
 * Both rendering surfaces (the CodeMirror live preview and the react-markdown
 * reading view) consume THIS module, so they can never disagree about what is
 * safe or what is renderable.
 *
 * The security posture is an allowlist by construction, not a sanitiser:
 * nothing here parses arbitrary HTML and then subtracts the dangerous parts.
 * Exactly five tags are recognised, in exactly two shapes, with exactly one
 * attribute, whose value is re-serialised from scratch. Anything else stays
 * literal document text, which is what it renders as today.
 */

export const INLINE_HTML_TAGS = ["u", "sup", "sub", "mark", "span"] as const;

export type InlineHtmlTag = (typeof INLINE_HTML_TAGS)[number];

/** `<tag>` or `<tag style="…">`. Double quotes only — no other attribute. */
const OPEN_RE = /^<(u|sup|sub|mark|span)(?:\s+style\s*=\s*"([^"<>]{0,128})")?\s*>$/i;
const CLOSE_RE = /^<\/(u|sup|sub|mark|span)\s*>$/i;

/** Matches any tag-shaped run, so the scanner can consider and reject. */
const ANY_TAG_RE = /<\/?[a-z][^<>]{0,160}>/gi;

/** Characters that must never appear in a style value we are about to emit.
 *  `&` is banned outright so entity-encoded payloads (`&#117;rl(`) cannot smuggle
 *  anything past us without needing an entity decoder. `;` is banned, which is
 *  what makes "exactly one declaration" true by construction. */
const STYLE_FORBIDDEN = /[&\\;{}<>"'@]/;
const STYLE_FORBIDDEN_SUBSTRINGS = ["url(", "expression(", "image(", "/*", "//"];

const ALLOWED_PROPS = new Set(["color", "background", "background-color"]);
const HEX = /^#[0-9a-f]{3,8}$/i;
const KEYWORD = /^[a-z]{3,20}$/;

/**
 * Re-serialise a style attribute, or reject it.
 *
 * Returns a freshly built string — no part of the author's input is echoed
 * verbatim. `background` is normalised to `background-color` so the shorthand's
 * image slot is structurally unreachable, which removes the whole `url()` class
 * of attack rather than filtering for it.
 */
export function safeStyle(raw: string): string | null {
  if (STYLE_FORBIDDEN.test(raw)) return null;
  const lowered = raw.toLowerCase();
  if (STYLE_FORBIDDEN_SUBSTRINGS.some((bad) => lowered.includes(bad))) return null;

  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const prop = raw.slice(0, colon).trim().toLowerCase();
  const value = raw.slice(colon + 1).trim();
  if (!ALLOWED_PROPS.has(prop)) return null;
  if (!HEX.test(value) && !KEYWORD.test(value)) return null;

  const property = prop === "background" ? "background-color" : prop;
  return `${property}: ${value.toLowerCase()}`;
}

export type ParsedTag =
  | { kind: "open"; tag: InlineHtmlTag; style: string | null }
  | { kind: "close"; tag: InlineHtmlTag };

/** Classify one tag-shaped string. Null means "not ours — leave it as text". */
export function parseInlineHtml(source: string): ParsedTag | null {
  const close = CLOSE_RE.exec(source);
  if (close) return { kind: "close", tag: close[1].toLowerCase() as InlineHtmlTag };

  const open = OPEN_RE.exec(source);
  if (!open) return null;
  const tag = open[1].toLowerCase() as InlineHtmlTag;
  const rawStyle = open[2];
  if (rawStyle === undefined) return { kind: "open", tag, style: null };
  const style = safeStyle(rawStyle);
  // A style we refuse to serialise makes the whole tag untrusted: render it as
  // text rather than silently dropping the attribute the author asked for.
  return style === null ? null : { kind: "open", tag, style };
}

export interface InlineHtmlSpan {
  tag: InlineHtmlTag;
  /** Already re-serialised, or null for a bare tag. */
  style: string | null;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

/**
 * Find every properly closed allowlisted span in `text`.
 *
 * Only same-tag pairs match, nesting is honoured, and an unmatched tag on
 * either side is ignored — it stays literal text, exactly as it renders today.
 */
export function findInlineHtmlSpans(text: string): InlineHtmlSpan[] {
  const open: { tag: InlineHtmlTag; style: string | null; from: number; to: number }[] = [];
  const spans: InlineHtmlSpan[] = [];

  ANY_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANY_TAG_RE.exec(text)) !== null) {
    const parsed = parseInlineHtml(m[0]);
    if (!parsed) continue;
    if (parsed.kind === "open") {
      open.push({ tag: parsed.tag, style: parsed.style, from: m.index, to: m.index + m[0].length });
      continue;
    }
    // Close the nearest unclosed open of the same tag.
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].tag !== parsed.tag) continue;
      const start = open[i];
      open.splice(i, 1);
      spans.push({
        tag: start.tag,
        style: start.style,
        openFrom: start.from,
        openTo: start.to,
        closeFrom: m.index,
        closeTo: m.index + m[0].length,
      });
      break;
    }
  }

  return spans.sort((a, b) => a.openFrom - b.openFrom);
}

/**
 * Drop allowlisted tags that have lost their partner.
 *
 * Excerpting hard-cuts text at a character budget and can slice a span in half,
 * which would otherwise show a bare `<span style="color:#e93147">` in a hover
 * preview — a new artifact created by the very feature meant to remove them.
 */
export function stripUnmatchedInlineHtml(text: string): string {
  const matched = new Set<number>();
  for (const s of findInlineHtmlSpans(text)) {
    matched.add(s.openFrom);
    matched.add(s.closeFrom);
  }
  ANY_TAG_RE.lastIndex = 0;
  return text.replace(ANY_TAG_RE, (tag, offset: number) =>
    parseInlineHtml(tag) && !matched.has(offset) ? "" : tag,
  );
}

/** CSS class applied to rendered spans, so themes can style them. */
export const INLINE_HTML_CLASS = "nodum-inline-html";
