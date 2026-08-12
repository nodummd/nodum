/**
 * Obsidian callout registry — the 13 types with aliases, Lucide icons, and
 * exact RGB colors from docs/research/obsidian-core-spec.md.
 * Shared by Live Preview (CM6 widgets) and Reading view.
 */

import {
  Bug,
  Check,
  CheckCircle2,
  ClipboardList,
  Flame,
  HelpCircle,
  Info,
  List,
  Pencil,
  Quote,
  X,
  Zap,
  createElement,
  AlertTriangle,
  type IconNode,
} from "lucide";

export interface CalloutType {
  /** canonical name */
  name: string;
  icon: IconNode;
  /** "r, g, b" — used as rgba(color, alpha) */
  color: string;
}

const TYPES: (CalloutType & { aliases: string[] })[] = [
  { name: "note", icon: Pencil, color: "8, 109, 221", aliases: [] },
  { name: "abstract", icon: ClipboardList, color: "0, 191, 188", aliases: ["summary", "tldr"] },
  { name: "info", icon: Info, color: "8, 109, 221", aliases: [] },
  { name: "todo", icon: CheckCircle2, color: "8, 109, 221", aliases: [] },
  { name: "tip", icon: Flame, color: "0, 191, 188", aliases: ["hint", "important"] },
  { name: "success", icon: Check, color: "8, 185, 78", aliases: ["check", "done"] },
  { name: "question", icon: HelpCircle, color: "236, 117, 0", aliases: ["help", "faq"] },
  { name: "warning", icon: AlertTriangle, color: "236, 117, 0", aliases: ["caution", "attention"] },
  { name: "failure", icon: X, color: "233, 49, 71", aliases: ["fail", "missing"] },
  { name: "danger", icon: Zap, color: "233, 49, 71", aliases: ["error"] },
  { name: "bug", icon: Bug, color: "233, 49, 71", aliases: [] },
  { name: "example", icon: List, color: "120, 82, 238", aliases: [] },
  { name: "quote", icon: Quote, color: "158, 158, 158", aliases: ["cite"] },
];

const REGISTRY = new Map<string, CalloutType>();
for (const t of TYPES) {
  REGISTRY.set(t.name, t);
  for (const alias of t.aliases) REGISTRY.set(alias, t);
}

/** Case-insensitive lookup; unknown types fall back to `note` styling but
 * keep their own name for data-callout (Obsidian behavior). */
export function calloutType(raw: string): CalloutType {
  const found = REGISTRY.get(raw.toLowerCase());
  if (found) return found;
  const note = REGISTRY.get("note");
  if (!note) throw new Error("callout registry missing note");
  return { ...note, name: raw.toLowerCase() };
}

/** First-line marker: `[!type]` / `[!type]-` / `[!type]+` plus optional title. */
export const CALLOUT_MARKER_RE = /^\[!(\w+)\]([+-]?)\s?(.*)$/;

/** Build the callout icon as a real SVG element (for CM6 widgets). */
export function calloutIconElement(type: CalloutType): SVGElement {
  const svg = createElement(type.icon);
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("stroke-width", "2");
  return svg;
}

/** Default title = capitalized type name (Obsidian). */
export function calloutDefaultTitle(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
