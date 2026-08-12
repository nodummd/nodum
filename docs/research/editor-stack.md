# Editor Stack Research: Obsidian-Quality Markdown Editor on the Web (CodeMirror 6)

Researched 2026-08-12. All versions verified against the npm registry on that date.

---

## 1. Package versions (verified via `npm view <pkg> version`, 2026-08-12)

### CodeMirror 6 core

| Package | Version | Purpose |
|---|---|---|
| `codemirror` | 6.0.2 | Meta-package (basic setup); prefer picking packages individually |
| `@codemirror/state` | 6.7.1 | EditorState, StateField, Facet, Compartment |
| `@codemirror/view` | 6.43.8 | EditorView, Decoration, WidgetType, ViewPlugin |
| `@codemirror/language` | 6.12.4 | syntaxTree(), HighlightStyle, language support |
| `@codemirror/commands` | 6.10.4 | history, default keymap, indent |
| `@codemirror/autocomplete` | 6.20.3 | CompletionSource, autocompletion() |
| `@codemirror/search` | 6.7.1 | search panel |
| `@codemirror/lang-markdown` | 6.5.2 | Markdown language (commonmark + GFM + Subscript/Superscript/Emoji) |
| `@lezer/markdown` | 1.7.2 | The incremental markdown parser; `MarkdownConfig` extension API |
| `@lezer/highlight` | 1.2.3 | `Tag`, `styleTags`, custom tags for wikilinks/hashtags |
| `@uiw/react-codemirror` | 4.25.11 | Optional React wrapper (or mount EditorView manually in a ref — recommended for full control) |
| `@replit/codemirror-vim` | 6.4.0 | Optional vim mode |
| `y-codemirror.next` | 0.3.5 | Optional Yjs collaboration binding |

### Reading-view (remark/rehype) pipeline

| Package | Version | Purpose |
|---|---|---|
| `unified` | 11.0.5 | Pipeline runner |
| `remark-parse` | 11.0.0 | md → mdast |
| `remark-gfm` | 4.0.1 | Tables, strikethrough, task lists, autolinks, footnotes |
| `remark-math` | 6.0.0 | `$...$` / `$$...$$` → math nodes |
| `remark-rehype` | 11.1.2 | mdast → hast |
| `rehype-katex` | 7.0.1 | math nodes → KaTeX HTML |
| `katex` | 0.18.4 | Peer dep of rehype-katex (import `katex/dist/katex.min.css`) |
| `react-markdown` | 10.1.0 | React component running the unified pipeline with a `components` map |
| `remark-wiki-link` | 2.0.1 | `[[Wiki Links]]` in reading view (micromark-based) |
| `@portaljs/remark-wiki-link` | 1.2.0 | Alternative: Obsidian-style shortest-path resolution, `[[page#header\|alias]]`, embeds (`![[img.png]]`) — closer to Obsidian semantics |
| `rehype-callouts` | 2.2.0 | Obsidian/GitHub-style callouts (`> [!note]`) — **the maintained option**; `remark-obsidian-callout` (1.5.1) is officially unmaintained and its README points here |
| `@r4ai/remark-callout` | 0.6.2 | Alternative remark-side callout plugin (older, still works) |
| `remark-callouts` | 2.0.0 | Another alternative (Flowershow lineage); less active |
| `remark-frontmatter` | 5.0.0 | YAML frontmatter stripping/parsing |
| `remark-breaks` | 4.0.0 | Optional: Obsidian's "strict line breaks: off" behavior |
| `rehype-raw` | 7.0.0 | Allow inline HTML in notes (pair with `rehype-sanitize` 6.0.0 if content is untrusted) |
| `rehype-slug` / `rehype-autolink-headings` | 6.0.0 / 7.1.0 | Heading anchors for `[[note#heading]]` targets |
| `mermaid` | 11.16.1 | Diagrams, client-side render in a React component (see §4.4) |
| `rehype-mermaid` | 3.0.0 | Build-time/SSR alternative only — uses Playwright via `mermaid-isomorphic`, NOT for the browser bundle |
| `@shikijs/rehype` / `shiki` | 4.4.3 | Code block highlighting in reading view (or `react-syntax-highlighter` 16.1.1 for a lighter client-only path) |

### Prior art / reference implementations

| Project | Where | What to steal |
|---|---|---|
| **SilverBullet** | github.com/silverbulletmd/silverbullet → `client/codemirror/` | The best production-grade Obsidian-style live preview in OSS. Files: `clean.ts` (plugin registry), `hide_mark.ts`, `util.ts` (`decoratorStateField`, `isCursorInRange`, `invisibleDecoration`, `LinkWidget`), `task.ts` (checkbox widget), `wiki_link.ts`, `table.ts`, `fenced_code.ts`, `block_quote.ts`, `admonition.ts`, `hashtag.ts`, `frontmatter.ts`. Also `client/markdown_parser/parser.ts` for the Lezer `MarkdownConfig` WikiLink/Hashtag parser extensions. MIT. |
| **ixora** (`@retronav/ixora` 0.3.3) | github.com/retronav/ixora (mirror of codeberg.org/retronav/ixora) | The original extension pack SilverBullet forked from. Clean, small, Apache-2.0. Headings, hidden marks, links, lists, blockquote, frontmatter. Good to read; slow-moving as a dependency — prefer vendoring the patterns. |
| **atomic-editor** | github.com/kenforthewin/atomic-editor | CM6 + React Obsidian-style inline live preview; hides syntax on inactive lines without changing line heights. |
| **codemirror-live-markdown** | github.com/blueberrycongee/codemirror-live-markdown (see `CODEMIRROR_LIVE_PREVIEW_DESIGN.md`) | Excellent design doc: `shouldShowSource()` logic, mouse-drag guard field, position caching, KaTeX widget caching, CSS `max-width` transition trick for hiding marks without layout jumps. |
| **codemirror-rich-markdoc** | github.com/segphault/codemirror-rich-markdoc (npm 0.0.2) | Minimal reference for mark-hiding + block widget replacement. |
| **codemirror-rich-obsidian** | github.com/Type-32/codemirror-rich-obsidian | Attempt at exact Obsidian OFM WYSIWYG; useful for edge cases. |
| **HyperMD** | github.com/laobubu/HyperMD | CM5-era; conceptually the ancestor. Do not use — patterns above supersede it. |

**Recommendation:** do not depend on ixora or any of the small packages directly. Vendor the pattern (≈600 lines total) like SilverBullet did. You control node names, styling, and behavior; the packages are thin wrappers over the same ~5 CM6 APIs.

---

## 2. Live Preview architecture (Obsidian-style)

### 2.1 Core idea

Obsidian's Live Preview = the document is always plain markdown text; a set of decoration
extensions *replace or hide* syntax tokens **only when the selection does not touch the
enclosing element**. Three decoration kinds:

- `Decoration.replace({})` — collapse a range to nothing (hide `**`, `##`, `[[`), or replace with a `WidgetType` (checkbox, rendered math, image embed).
- `Decoration.mark({class})` — style a range without changing content (bold text itself, hashtag pill).
- `Decoration.line({class})` — style a whole line (heading size, blockquote border, `>` gutter).
- `Decoration.widget({widget, side})` — insert DOM at a position (list bullet dot, checkbox before text).

### 2.2 StateField vs ViewPlugin — the 2026 consensus

Use a **StateField** (not ViewPlugin) for any decoration set that contains
**block-level replace decorations or widgets that can change line count/height**
(tables, math blocks, fenced code, embeds). ViewPlugin decorations may not
influence vertical layout across lines. Use a **ViewPlugin** only for cheap,
viewport-limited inline marks where you want to skip offscreen work.
SilverBullet runs everything through one StateField helper:

```ts
// util.ts pattern (SilverBullet, forked from ixora)
import { StateField, EditorState, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

export function decoratorStateField(
  mapper: (state: EditorState) => DecorationSet,
) {
  return StateField.define<DecorationSet>({
    create: (state) => mapper(state),
    update(value, tr: Transaction) {
      // IME composition: map old decorations instead of recomputing
      if (tr.isUserEvent("input.type.compose"))
        return tr.docChanged ? value.map(tr.changes) : value;
      // Skip recompute mid mouse-drag selection (prevents flicker)
      if (tr.isUserEvent("select.pointer")) return value;
      return mapper(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

export const invisibleDecoration = Decoration.replace({});

export function isCursorInRange(state: EditorState, [from, to]: [number, number]) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}
```

The two `isUserEvent` guards are the important production details most toy
implementations miss (IME correctness on CJK input; no flicker while drag-selecting).

### 2.3 Hiding formatting marks (bold/italic/code/strikethrough/highlight)

Walk the Lezer syntax tree; for each styled span whose range does **not** contain the
cursor, replace its child `*Mark` nodes with `invisibleDecoration`:

```ts
import { syntaxTree } from "@codemirror/language";

const typesWithMarks = ["Emphasis", "StrongEmphasis", "InlineCode",
  "Highlight", "Strikethrough", "Superscript", "Subscript"];
const markTypes = ["EmphasisMark", "CodeMark", "HighlightMark",
  "StrikethroughMark", "SuperscriptMark", "SubscriptMark"];

export const hideMarks = decoratorStateField((state) => {
  const decos: Range<Decoration>[] = [];
  let parentRange: [number, number] | undefined;
  syntaxTree(state).iterate({
    enter: ({ type, from, to, node }) => {
      if (!typesWithMarks.includes(type.name)) return;
      // nested (bold-in-italic): skip if already covered by parent
      if (parentRange && from <= parentRange[1] && parentRange[0] <= to) return;
      parentRange = [from, to];
      if (isCursorInRange(state, [from, to])) return; // reveal source
      node.toTree().iterate({
        enter({ type, from: mf, to: mt }) {
          if (markTypes.includes(type.name))
            decos.push(invisibleDecoration.range(from + mf, from + mt));
        },
      });
    },
  });
  return Decoration.set(decos, true); // true = sort
});
```

### 2.4 Headings

When cursor is outside the `ATXHeading{1..6}` node, hide `from → from + level + 1`
(the hashes and the space); always add a `Decoration.line` class for font sizing so
line height never jumps when the marks reappear (size lines via CSS class, not via
presence of hidden text). See SilverBullet `hide_mark.ts → hideHeaderMarkPlugin`.

### 2.5 Block elements (tables, math, code fences, embeds)

Pattern: when cursor is outside the block node, `Decoration.replace({ widget, block: true })`
over the whole block range with a `WidgetType` that renders the HTML (table via your
reading-view renderer; math via KaTeX; mermaid via mermaid.render). When the cursor
enters, decoration is dropped and raw source shows. Cache rendered HTML keyed by
source text (KaTeX/mermaid render cost). Give widgets `eq()` so CM6 reuses DOM.

Optional: `EditorView.atomicRanges.of(f)` over your replace decorations so arrow
keys skip over widgets instead of stepping through hidden positions:

```ts
const atomic = EditorView.atomicRanges.of(
  (view) => view.state.field(blockDecoField) ?? Decoration.none,
);
```

### 2.6 Making the parser see [[wikilinks]] and #tags

`@codemirror/lang-markdown` accepts Lezer `MarkdownConfig` extensions. Define custom
inline nodes so the tree has `WikiLink` / `Hashtag` nodes (SilverBullet
`client/markdown_parser/parser.ts` is the canonical example):

```ts
import { MarkdownConfig } from "@lezer/markdown";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { styleTags, Tag } from "@lezer/highlight";

export const wikiLinkTag = Tag.define();

const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: wikiLinkTag },
    { name: "WikiLinkPage" }, { name: "WikiLinkAlias" },
    { name: "WikiLinkMark", style: t.processingInstruction },
  ],
  parseInline: [{
    name: "WikiLink",
    after: "Emphasis",
    parse(cx, next, pos) {
      if (next !== 91 /* '[' */ && next !== 33 /* '!' */) return -1;
      const re = /^(?<lead>!?\[\[)(?<ref>[^[\]|]+)(\|(?<alias>[^[\]]+))?\]\]/;
      const m = re.exec(cx.slice(pos, cx.end));
      if (!m?.groups) return -1;
      const end = pos + m[0].length;
      const { lead, ref, alias } = m.groups;
      const children = [
        cx.elt("WikiLinkMark", pos, pos + lead.length),
        cx.elt("WikiLinkPage", pos + lead.length, pos + lead.length + ref.length),
        // ... alias elements if present ...
        cx.elt("WikiLinkMark", end - 2, end),
      ];
      return cx.addElement(cx.elt("WikiLink", pos, end, children));
    },
  }],
};

const lang = markdown({
  base: markdownLanguage,       // commonmark + GFM + Sub/Superscript + Emoji
  extensions: [WikiLink, Hashtag /* similar parseInline for #tag */],
});
```

Then a `decoratorStateField` finds `WikiLink` nodes: cursor outside → hide the `[[ ]]`
marks (and the `page|` prefix when aliased) and wrap the visible text in a clickable
`LinkWidget` (an `<a>` with click/touch handlers — see SilverBullet `util.ts →
LinkWidget`, which stops propagation and calls a navigate callback; Alt-click moves
the cursor into the link instead of navigating).

---

## 3. Autocomplete for [[wikilinks]] and #tags (@codemirror/autocomplete 6.20.3)

One `CompletionSource` per trigger, registered via `autocompletion({ override: [...] })`
or the language's `languageData.autocomplete`. `matchBefore` does the work:

```ts
import { CompletionContext, CompletionResult, autocompletion } from "@codemirror/autocomplete";

function wikiLinkCompletions(getPages: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    // match "[[..." (no closing bracket yet) before cursor
    const m = ctx.matchBefore(/\[\[([^\[\]]*)$/);
    if (!m) return null;
    return {
      from: m.from + 2,                    // complete after the brackets
      options: getPages().map((p) => ({
        label: p,
        type: "text",
        apply: p + "]]",                   // insert closing brackets
      })),
      validFor: /^[^\[\]]*$/,              // keep list open while typing
    };
  };
}

function tagCompletions(getTags: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/#[\w/-]*$/);
    if (!m || (m.from === m.to && !ctx.explicit)) return null;
    return {
      from: m.from + 1,
      options: getTags().map((t) => ({ label: t, type: "keyword" })),
      validFor: /^[\w/-]*$/,
    };
  };
}

const completions = autocompletion({
  override: [wikiLinkCompletions(getPages), tagCompletions(getTags)],
  icons: false,
});
```

Notes:
- `apply` can be a function `(view, completion, from, to) => …` for smarter behavior
  (don't double-insert `]]` if already present ahead of the cursor: check
  `view.state.sliceDoc(to, to + 2) === "]]"`).
- For `[[page#heading]]` and `[[page^block]]` completion, run a second stage: if
  `matchBefore(/\[\[([^\[\]#|]+)#([^\[\]]*)$/)` matches, complete headings of that page.
- Add `closeBrackets()` config so typing `[[` auto-inserts `]]` (map `[` in a custom
  input handler, or just let the completion's `apply` handle it).
- SilverBullet uses `startCompletion/closeCompletion/completionStatus` from the same
  package to programmatically pop the completion list (see `task.ts` dropdown widget).

---

## 4. Reading view rendering pipeline (React)

### 4.1 Recommended pipeline

`react-markdown@10.1.0` with this plugin set:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import wikiLinkPlugin from "@portaljs/remark-wiki-link"; // or remark-wiki-link
import rehypeKatex from "rehype-katex";
import rehypeCallouts from "rehype-callouts";
import rehypeSlug from "rehype-slug";
import "katex/dist/katex.min.css";
import "rehype-callouts/theme/obsidian"; // ships an Obsidian theme css

<ReactMarkdown
  remarkPlugins={[
    remarkFrontmatter,
    remarkGfm,
    remarkMath,
    [wikiLinkPlugin, {
      pathFormat: "obsidian-short",         // @portaljs: shortest-path resolution
      permalinks: allNotePaths,             // existing notes → resolved links
      hrefTemplate: (permalink: string) => `/note/${permalink}`,
    }],
  ]}
  rehypePlugins={[rehypeKatex, rehypeCallouts, rehypeSlug]}
  components={{
    code: CodeBlock,        // dispatch: lang === "mermaid" → <Mermaid/>, else shiki/highlighter
    a: NoteLink,            // intercept internal hrefs → client-side navigation
    input: TaskCheckbox,    // enable checkbox toggling (see §5)
    li: TaskListItem,
  }}
>{markdown}</ReactMarkdown>
```

### 4.2 Wikilinks: which package

- `@portaljs/remark-wiki-link@1.2.0` — best Obsidian fidelity: `[[page]]`,
  `[[page|alias]]`, `[[page#heading]]`, `![[embeds]]`, shortest-path resolution
  against a `permalinks` list. Maintained by DataHub/Flowershow (powers PortalJS).
- `remark-wiki-link@2.0.1` — the original, micromark-based, simpler options
  (`pageResolver`, `hrefTemplate`, `aliasDivider: "|"`). Fine if you don't need embeds.

### 4.3 Callouts: which package

- **Use `rehype-callouts@2.2.0`.** Supports Obsidian syntax incl. collapsible
  `> [!note]- Title`, nested callouts, custom types, ships themes (obsidian/github/vitepress).
  `remark-obsidian-callout@1.5.1` README declares itself unmaintained and redirects here.
- Alternatives: `@r4ai/remark-callout@0.6.2` (remark-side, headless), `remark-callouts@2.0.0`.

### 4.4 Mermaid in React

`rehype-mermaid@3.0.0` is **server/build-only** (Playwright). In the browser, render
client-side with `mermaid@11.16.1`:

```tsx
import mermaid from "mermaid";
mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const id = useId().replace(/:/g, "m");
  useEffect(() => {
    let live = true;
    mermaid.render(id, code)
      .then((r) => live && setSvg(r.svg))
      .catch(() => live && setSvg(""));  // show raw code on parse error
    return () => { live = false; };
  }, [code, id]);
  return svg
    ? <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    : <pre>{code}</pre>;
}
// In the `code` component: if (className === "language-mermaid") return <Mermaid code={children}/>;
```

Same component doubles as the CM6 block widget's renderer in Live Preview (§2.5) —
share the render cache between the two views.

### 4.5 Code highlighting

`@shikijs/rehype@4.4.3` (build/worker, best output) or `react-syntax-highlighter@16.1.1`
(simple client-only) in the `code` component. Match the CM6 editor theme tokens for
visual continuity between Live Preview and Reading view.

---

## 5. Checkbox toggling and interactive widgets

### 5.1 In the editor (Live Preview) — CM6 widget

Replace `TaskMarker` (`[ ]` / `[x]`, node name from GFM TaskList in @lezer/markdown)
with a real `<input type=checkbox>` widget; on click, resolve the *current* doc
position via `posAtDOM` (never trust the position captured at decoration build time —
the doc may have changed) and dispatch a text replacement:

```ts
class CheckboxWidget extends WidgetType {
  private dom?: HTMLElement;
  constructor(readonly checked: boolean, readonly fallbackPos: number,
              readonly getView: () => EditorView | null) { super(); }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-task-checkbox";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    box.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      const view = this.getView();
      let pos = this.fallbackPos;
      if (view && this.dom) { try { pos = view.posAtDOM(this.dom, 0) + 1; } catch {} }
      if (!view) return;
      // pos points inside "[x]"; flip the state char
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const m = /^(\s*[-*+]\s+\[)( |x|X)(\])/.exec(text);
      if (!m) return;
      const chPos = line.from + m[1].length;
      view.dispatch({
        changes: { from: chPos, to: chPos + 1, insert: m[2] === " " ? "x" : " " },
      });
    });
    wrap.appendChild(box);
    this.dom = wrap;
    return wrap;
  }
  eq(other: WidgetType) {
    return other instanceof CheckboxWidget && other.checked === this.checked;
  }
  ignoreEvent() { return true; } // let the widget own its pointer events
}

// In the decorator: find Task nodes; when cursor outside, replace the
// TaskMarker range with Decoration.replace({ widget: new CheckboxWidget(...) });
// when cursor inside, still show the widget but keep the text (Obsidian shows both).
```

Key production details (all from SilverBullet `client/codemirror/task.ts`):
- `preventDefault` on `click`, act on `mouseup` — avoids CM6 selection side effects.
- Handle `touchend` separately for mobile (only when no `touchmove` happened).
- `posAtDOM(this.dom)` at click time; captured positions go stale.
- `eq()` implementation prevents DOM churn / checkbox focus loss on every keystroke.
- Optional custom task states (`[>]`, `[-]`) need an extended TaskMarker parser
  (SilverBullet `markdown_parser/extended_task.ts`).

### 5.2 In Reading view

`remark-gfm` emits `<input type="checkbox" disabled>`. Override the `input` component:
strip `disabled`, and on change, map back to the source: react-markdown passes
`node.position` (unist `position.start.line/offset`) — flip `[ ]`↔`[x]` at that
offset in the markdown string, update state/file. This gives Obsidian-parity
checkbox toggling in Reading view with no extra parser work.

### 5.3 Other interactive widgets

Same WidgetType recipe covers: image embeds (`![[img.png]]` → `<img>` widget with
width from `[[img.png|300]]`), copy buttons on fenced code, collapsible callout
chevrons in Live Preview, footnote hover previews. Rules of thumb: implement `eq()`,
implement `ignoreEvent()`, never store absolute positions inside the widget, and keep
heavy rendering (KaTeX/mermaid) behind a memo cache keyed on source text.

---

## 6. Recommended dependency list (package.json excerpt)

```jsonc
{
  // editor
  "@codemirror/state": "^6.7.1",
  "@codemirror/view": "^6.43.8",
  "@codemirror/language": "^6.12.4",
  "@codemirror/commands": "^6.10.4",
  "@codemirror/autocomplete": "^6.20.3",
  "@codemirror/search": "^6.7.1",
  "@codemirror/lang-markdown": "^6.5.2",
  "@lezer/markdown": "^1.7.2",
  "@lezer/highlight": "^1.2.3",
  // reading view
  "react-markdown": "^10.1.0",
  "remark-gfm": "^4.0.1",
  "remark-math": "^6.0.0",
  "remark-frontmatter": "^5.0.0",
  "@portaljs/remark-wiki-link": "^1.2.0",
  "rehype-katex": "^7.0.1",
  "katex": "^0.18.4",
  "rehype-callouts": "^2.2.0",
  "rehype-slug": "^6.0.0",
  "mermaid": "^11.16.1",
  "@shikijs/rehype": "^4.4.3"
}
```

Live Preview decorations: **write in-repo** (~600 LOC), vendoring patterns from
SilverBullet `client/codemirror/` (MIT) and ixora (Apache-2.0) rather than depending
on `@retronav/ixora@0.3.3` directly.

## Sources

- npm registry version checks via `npm view` (2026-08-12) for all packages above
- [SilverBullet](https://github.com/silverbulletmd/silverbullet) — `client/codemirror/{clean,hide_mark,util,task,wiki_link}.ts`, `client/markdown_parser/parser.ts`
- [ixora](https://github.com/retronav/ixora) / [ixora docs](https://ixora.karawale.in/)
- [atomic-editor](https://github.com/kenforthewin/atomic-editor)
- [codemirror-live-markdown design doc](https://github.com/blueberrycongee/codemirror-live-markdown/blob/main/CODEMIRROR_LIVE_PREVIEW_DESIGN.md)
- [codemirror-rich-obsidian](https://github.com/Type-32/codemirror-rich-obsidian)
- [CodeMirror autocompletion example](https://codemirror.net/examples/autocompletion/)
- [@codemirror/lang-markdown](https://github.com/codemirror/lang-markdown), [@lezer/markdown](https://www.npmjs.com/package/@lezer/markdown)
- [remark-obsidian-callout (deprecation notice)](https://github.com/escwxyz/remark-obsidian-callout), [rehype-callouts](https://www.npmjs.com/package/rehype-callouts)
- [remark-wiki-link](https://www.npmjs.com/package/remark-wiki-link), [@portaljs/remark-wiki-link](https://www.npmjs.com/package/@portaljs/remark-wiki-link)
