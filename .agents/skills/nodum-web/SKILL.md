---
name: nodum-web
description: Working on the nodum Next.js frontend (web/) — Obsidian UI rules, workspace architecture, CM6 live-preview editor internals, graph view, API/auth conventions, and React 19 lint constraints. Use when changing anything under web/src.
---

# Nodum Web

Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn (radix) + CM6 + cosmos.gl.

## UI law: match Obsidian exactly

- Colors ONLY via the tokens in `src/app/globals.css` (`--ob-*` scale,
  accent `hsl(254,80%,68%)`). No raw hex in components.
- Icons: Lucide only (Obsidian's own set). Never emoji.
- Fonts: system stack (`--font-interface`); UI text 13px, editor 16px.
- Specs live in `docs/research/obsidian-core-spec.md` + `obsidian-graph-spec.md`
  — check them before styling anything new.

## Architecture

- Server state = react-query (`queryKey`s: note/tree/graph/backlinks/tags per
  vault). UI/layout state = zustand (`workspace-store`, persisted; `auth-store`;
  `toast-store`). Network ONLY through `src/lib/api/endpoints.ts`.
- Auth: access token in memory (`lib/api/client.ts`), refresh cookie is
  httpOnly + first-party via the `/api/*` rewrite proxy. Hard-401 →
  `onAuthExpired` → store drops to anonymous. NEVER touch localStorage for
  tokens.
- The `/api/*` rewrite target is **inlined at build time** (`API_PROXY_URL`
  build arg in docker). Changing proxy config requires a rebuild.
- Workspace: `components/workspace/workspace.tsx` composes ribbon, sidebars,
  tab bar, editor pane, palette, switcher, toaster. Global hotkeys live there
  (⌘O/⌘N/⌘G/⌘P/⌘W/⌘E). New commands go in `command-palette.tsx`.

## Editor (CM6) rules

- Live preview decorations: `lib/editor/live-preview.ts` — reveal-on-cursor
  (`selectionTouches`), widgets need `eq()`, positions resolve via
  `posAtDOM` at event time, mousedown handler is left-button only.
- Custom syntax nodes (wikilinks/tags/highlights) are Lezer `parseInline`
  extensions in `lib/editor/markdown-extensions.ts`.
- Callout registry shared by both surfaces: `lib/editor/callouts.ts`
  (vanilla `lucide` for DOM widgets, `lucide-react` in React).
- EditorPane keys the body by noteId (state resets by remount — no
  effect-syncing); autosave debounce 700ms with flush-on-unmount and 409
  recovery (adopt server timestamp + bounded resubmit).

## React 19 lint traps

- No setState in effects (derive or reset-by-key instead).
- No ref reads/writes during render (sync refs in an effect).

## Commands

```bash
cd web
npm run lint && npm run build     # both must pass before commit
npx playwright test               # 18 e2e; needs api :8000 + web :3100 running
PORT=3100 npm run dev             # 3000 is taken by an unrelated process
```
