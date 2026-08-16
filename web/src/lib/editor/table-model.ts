/**
 * The single parser for GFM table rows.
 *
 * Three places used to split table lines on their own, all of them naively on
 * every `|`: the table commands, the read-only preview widget, and the column
 * arithmetic. An escaped pipe therefore became a phantom column — and because
 * the row/column commands rewrite the table from their own parse, editing a
 * table containing `a \| b` silently corrupted it.
 *
 * Everything that needs to know where a cell starts and ends comes through
 * here, so the widget's column indices and the commands' column indices cannot
 * drift apart.
 */

export type Align = "left" | "center" | "right" | "none";

/** One cell of one line: its trimmed text plus offsets RELATIVE to line start. */
export interface RawCell {
  text: string;
  /** Offset of the first character of the trimmed content. */
  from: number;
  /** Offset one past the last character of the trimmed content. */
  to: number;
}

/** `|` that is not escaped as `\|`. A backslash run of even length does not
 *  escape the pipe (`\\|` is a literal backslash then a delimiter). */
function isDelimiter(line: string, i: number): boolean {
  if (line[i] !== "|") return false;
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
  return backslashes % 2 === 0;
}

/**
 * Split a table line into cells on unescaped pipes.
 *
 * The leading and trailing delimiters are structure, not cells. An
 * all-whitespace cell yields a ZERO-WIDTH span one space in from its opening
 * pipe, so an insert there lands padded on both sides — `insertTable` writes
 * `"   "` for every body cell, so this is the common case, not an edge case.
 */
export function splitCells(line: string): RawCell[] {
  const bounds: number[] = [];
  for (let i = 0; i < line.length; i++) if (isDelimiter(line, i)) bounds.push(i);
  if (bounds.length < 2) return [];

  const cells: RawCell[] = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const open = bounds[b];
    const close = bounds[b + 1];
    const raw = line.slice(open + 1, close);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const from = trimmed.length === 0 ? open + 1 + Math.min(1, raw.length) : open + 1 + lead;
    cells.push({ text: trimmed, from, to: from + trimmed.length });
  }
  return cells;
}

/** Cell text only — the replacement for the old private `splitRow`s. */
export function splitRow(line: string): string[] {
  return splitCells(line).map((c) => unescapeCell(c.text));
}

/** `\|` → `|` for display. */
export function unescapeCell(text: string): string {
  return text.replace(/\\\|/g, "|");
}

/** `|` → `\|` so a cell's content cannot invent a column, and newlines are
 *  flattened — a table cell is a single line by definition. */
export function escapeCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Display width used for padding. Escapes occupy source width, not visual
 *  width, so pad on the unescaped length or columns drift as cells gain pipes. */
export function cellWidth(text: string): number {
  return unescapeCell(text).length;
}

export function isRow(line: string): boolean {
  return splitCells(line).length > 0 && /^\s*\|/.test(line) && /\|\s*$/.test(line);
}

export function isDivider(line: string): boolean {
  const cells = splitCells(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.text));
}

export function alignOf(spec: string): Align {
  const s = spec.trim();
  if (s.startsWith(":") && s.endsWith(":")) return "center";
  if (s.endsWith(":")) return "right";
  if (s.startsWith(":")) return "left";
  return "none";
}

export function alignSpec(a: Align, width: number): string {
  const dashes = Math.max(3, width);
  if (a === "center") return `:${"-".repeat(dashes - 2)}:`;
  if (a === "right") return `${"-".repeat(dashes - 1)}:`;
  if (a === "left") return `:${"-".repeat(dashes - 1)}`;
  return "-".repeat(dashes);
}

/** Minimal inline markdown for a table cell — bold, italic, code, strike.
 *  Escapes first, so cell text can never inject markup. */
export function renderCellHTML(cell: string): string {
  const escaped = cell.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}
