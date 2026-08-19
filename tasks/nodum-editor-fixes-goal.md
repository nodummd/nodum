# GOAL — Editor correctness pass (Aug 2026)

Working document for the current mandate. Ordered by severity, not by the order
the issues were reported. Every item carries a **verified** reproduction — no
item here is speculative.

Companion to `tasks/nodum-master-plan.md`; log outcomes there as items land.

## Working rules for this goal

1. **Reproduce before fixing.** Every item below was reproduced live against the
   demo vault (`demo@vorreix.com`, "Second Brain") or demonstrated against the
   running dev services. Re-confirm before starting an item — the code moves.
2. **Prove the test is not vacuous.** After writing a test, revert the fix and
   watch it fail. A test that passes both ways has taught us nothing. This has
   already caught two bad tests in this project.
3. **No speculative changes.** If a defect cannot be demonstrated, do not "fix"
   it. One speculative guard was already written and retracted this month.
4. One item per feature branch, merged `--no-ff` to `dev`.
5. `cd web && npm run lint && npm run build` on every frontend change;
   `uv run pytest tests/unit tests/integration && uv run ruff check .` on every
   backend change. Full Playwright suite before merge.

---

## P0-1 — Inline HTML renders as literal source text

**Status:** ✅ DONE 2026-08-15 (`0988105`). Shared allowlist module
`lib/editor/inline-html.ts` feeds a CM6 decoration (live preview) and a remark
plugin (reading view). Verified live on the user's own note — "Computation"
underlined, "pure" at `rgb(236, 117, 0)` = the chosen `#ec7500`, no raw tags —
and a hostile probe (`<script>`, `onerror`, `url(javascript:)`, a
two-declaration style, `<img onerror>`, an unclosed tag) produced **zero**
elements on either surface. 29 unit cases + 3 e2e; the rendering cases fail when
the decoration/plugin are removed.

**Reproduction (live, demo vault).** "Functional Programming" contains
`**<u>Computation</u>**` and `<span style="color:#ec7500">pure</span>`. Both
render as raw text in live preview *and* reading view: 0 elements carry that
colour, 0 `<u>` / `<sup>` / `<mark>` tags exist in the DOM. "How to Take Smart
Notes" carries `<span style="color:#e93147">` — the exact string the user
quoted. Three real notes are affected.

**Severity.** This is the worst item: five menu commands (Text colour, Highlight
colour, Underline, Superscript, Subscript) write markup into the user's notes
that renders as garbage. It is not merely a dead control — it *corrupts content*.

**Root cause — two independent gaps, one per surface.**

- *Reading view.* `react-markdown` v10 always merges
  `{allowDangerousHtml: true}` into its remark-rehype options, so mdast `html`
  nodes become hast `raw` nodes; then its `transform()` visitor replaces every
  `raw` node with a **text node**
  (`web/node_modules/react-markdown/lib/index.js:364`). There is no `rehype-raw`
  and no sanitizer. Adding `rehype-raw` + a subtractive sanitizer was considered
  and rejected: react-markdown hard-forces `allowDangerousHtml`, so that route
  parses arbitrary HTML and then subtracts, which is the wrong default.
- *Live preview.* No CM6 decoration has ever handled inline HTML; the tags are
  ordinary document text.

**Fix.** One shared pure module, `web/src/lib/editor/inline-html.ts`, consumed by
both surfaces so they cannot diverge.

- Allowlist exactly `u`, `sup`, `sub`, `mark`, `span`. Two accepted shapes:
  `<tag>` and `<tag style="…">`, double quotes only. Everything else stays
  literal text, exactly as today.
- `safeStyle` works by **re-serialisation, not filtering** — nothing the author
  wrote survives verbatim. Reject any raw value containing
  `& \ ; { } < > " ' @` or `url(` / `expression(` / `image(` / `/*`. Accept
  exactly one declaration whose property is `color` / `background` /
  `background-color`, normalising `background` → `background-color` so the
  shorthand's image slot is structurally unreachable. The value must match
  `/^#[0-9a-f]{3,8}$/i` or a short bare CSS keyword. Emit a freshly built string.
- *Reading view:* a small remark plugin converting allowlisted `html` nodes into
  custom mdast nodes, mapped through react-markdown's `components`. No new
  dependency. (DOMPurify is present transitively via mermaid — do **not** rely on
  a transitive dep.)
- *Live preview:* `Decoration.replace` over the tag ranges (revealed when the
  selection touches them, matching the existing marker behaviour in
  `live-preview.ts`) plus a `Decoration.mark` carrying the inline style over the
  content between.

**Corrections carried from the adversarial review — do not lose these:**

- Banning `;` means **exactly one** declaration is possible. An earlier draft said
  "split into at most 2 declarations"; that is unreachable. Accept one.
- A bare `<mark>` with no style must still render highlighted. A rule that only
  sets `border-radius` leaves imported Obsidian `<mark>` invisible.
- `page-preview.tsx` `excerpt()` hard-cuts at 700 chars and can slice a tag in
  half, producing a new unmatched-tag artifact. Strip unmatched allowlisted tags
  from excerpts.
- `block-widgets.ts` `renderCellHTML` escapes `&`/`<`/`>` *first*; table cells
  need explicit thought rather than reuse of the inline path.

**Acceptance.** A note containing all five effects renders styled in live
preview and reading view; `<script>`, `onerror=`, `url(...)`, and a `style` with
two declarations all remain inert literal text; e2e proves each, and fails when
the decoration/plugin is removed.

---

## P0-2 — Collab loses work in production (`--workers 4`)

**Status:** ✅ DONE 2026-08-19 (`feature/1.collab-fanout`): shared seed, late-join sync, single persist owner, presence fanout, join/teardown race, local undo. See `tasks/nodum-release-cycle-goal.md`.

**R2 — cross-worker fanout does not work for any non-empty note.** Prod runs
`uvicorn --workers 4` (`back/build/Dockerfile.api:62-65`). Each worker builds its
own `YRoom` per note and seeds it with `ytext += content` (`collab.py:109-111`)
*before* the update observer is attached (`:123`) — so the seed is never
published, by design. Worker B therefore has no trace of worker A's client
id/clock range, and every update A publishes references A's seed items.
Confirmed with pycrdt: B applies A's update, B's text does not change, and B's
observer never fires — the update sits in yrs' pending store forever.

Consequence with two users on different workers: they never see each other,
presence never appears, and **each worker's persist loop writes its whole
document every 3s with no version check**, so the note flip-flops in the database
and one user's work is gone on reload. Empty notes replicate fine (no seed, no
gap), which is why this was never caught. The e2e passes only because CI runs a
single worker (`.github/workflows/ci-e2e.yml:58`).

**R1 — ✅ FIXED 2026-08-15 (`fc8428e`).** Redis pub/sub connection leak,
reproduced against dev Redis (dies at cycle 20) and closed with a `finally:
await pubsub.aclose()`. Regression test proved non-vacuous. Original writeup: `_subscribe` creates a
`pubsub` (`collab.py:161-162`) and never closes it; `delete_room` only cancels
the task. redis-py's `PubSub.__del__` does not return the connection to the pool,
and `redis_binary` caps at `max_connections=20`. After 20 room opens per worker —
which is just 20 note switches — every subscribe *and* publish raises
`Too many connections`, and both are swallowed as warnings. Fanout dies silently
and the worker goes deaf to `collab-reset`, so the "REST save reverts the note"
bug we fixed **silently returns** and never recovers until restart.

**Immediate mitigation (do this first, it is one line):** turn `collabEnabled`
off for the demo vault until R1 and R2 land. The feature can lose work.

**Fix.**
- R1 (S): own the PubSub lifetime — `async with redis_binary.pubsub(...)` or a
  `finally: await pubsub.aclose()`. The cancel in `delete_room` stays; the
  `finally` then runs on `CancelledError` and returns the connection.
- R2 (S as configuration, L as code): for v3.3.0, pin collab to a single worker
  (drop `--workers 4` for the collab route, or route
  `/api/v1/vaults/*/notes/*/collab` to a dedicated single-worker service). The
  real fix is a deterministic shared seed (apply one identical serialized update
  in every worker) or a single owner worker per room elected with a Redis lock.
  Either way, correct `docs/collab.md`, which currently promises working
  cross-worker fanout.
- R3 (M): close the join/delete race where a client joins a room being torn down
  and its whole session goes unpersisted.

**Acceptance.** A regression test opens >20 rooms in one worker and proves fanout
still works. A test with two documents seeded the way the server seeds them
proves an update from one reaches the other. `docs/collab.md` matches reality.

---

## P1-3 — Undo history is destroyed when you leave a note and come back

**Status:** ✅ DONE 2026-08-19 (`feature/2.undo-history`): Stages A–C + Windows redo chord; ⌘U kept for underline. See `tasks/nodum-release-cycle-goal.md`.

**Reproduction (live).** Type `UNDOTEST` into a note → ⌘Z removes it → ⌘⇧Z
restores it (both work *in place*). Switch to another tab and back → ⌘Z does
nothing; `UNDOTEST` stays. History is gone.

**Root cause.** The `EditorState` is thrown away and rebuilt from scratch, and
nothing ever serializes `historyField` (`grep toJSON|fromJSON web/src` → zero
hits). `workspace.tsx` renders only the *active* tab, so switching tabs unmounts
the outgoing editor entirely; `markdown-editor.tsx` then runs
`EditorState.create` with a fresh `history()`.

**Fix — staged. The adversarial review marked the original four-layer plan
`fixViable: false`; these corrections are load-bearing:**

- **Stage A (safe, land first): stop rebuilding for mode/pref changes.** Replace
  the `[mode, vaultId, showLineNumbers, spellcheck]` dependency list with
  `Compartment` reconfiguration. Reconfiguring preserves the entire
  `EditorState`, history included — no serialization needed. Kills the
  mode-toggle and preference-change remounts outright.
- **Stage B (safe): redo chords.** Confirm `Mod-Shift-z` and add `Mod-y`.
  (`@codemirror/commands` exports `redo`, `redoDepth`, and `historyField` —
  verified in this repo's `node_modules`.)
- **Stage C (the headline fix, most fragile): per-tab history snapshots.**
  Serialize with `EditorState.toJSON({history: historyField})` on unmount and
  restore with `EditorState.fromJSON(json, config, {history: historyField})`.
  - **Key by pane *and* note**, not note alone — `splitRight` can mount the same
    note in two panes, and a note-only key makes the two editors fight over one
    history.
  - **The staleness guard must compare against the doc the snapshot was taken
    from**, stored alongside it — not against the note's saved content. Switching
    tabs within the 700 ms autosave debounce triggers the unmount flush, so the
    saved content legitimately differs, which is exactly the headline scenario.
  - Bound the cache (LRU, ~20 entries) so history for many notes cannot grow
    without limit.
- **Stage D (defer, and only with care): replacing the `editorEpoch` remounts
  with transactions.** Dispatching into the live view fires the update listener,
  which schedules an autosave and can create a version-snapshot loop. Needs an
  annotation marking the change as non-user-originated. Not required for the
  reported bug — do it last or not at all.
- **Collab interaction:** when a collab session is live, `yCollab` supplies its
  own `Y.UndoManager`. Establish empirically what it binds before touching the
  keymap — an earlier claim that it installs `yUndoManagerKeymap` by default was
  refuted.

### Four further defects found in the same area — fix these with Stage B

These are separate from the history-loss bug and individually reproducible.

1. **⌘E switches to reading view while also being the inline-code chord.**
   *Verified live:* pressing ⌘E in the editor flips the pane to reading view and
   unmounts the editor (`editorGone: true`), destroying the undo stack. `Mod-e`
   is also bound to `toggleInlineCode` (`markdown-editor.tsx:87`) and returns
   without stopping propagation, so the window-level hotkey at
   `workspace.tsx:358-361` fires too — meaning one keypress should both mutate
   the document and unmount the editor. *The view-switch half is confirmed; the
   simultaneous backtick insertion is from code reading and must be confirmed
   during the fix.* Regression introduced when the ⌘E binding was added:
   `Mod-[` / `Mod-]` were given the consume-the-chord treatment and ⌘E was not.
2. **⌘U shadows `undoSelection`.** `Mod-u` → `toggleUnderline`
   (`markdown-editor.tsx:86`) precedes `historyKeymap`, so CodeMirror's
   `undoSelection` is dead code. Same origin as (1). Decide deliberately: keep
   ⌘U for underline (Obsidian-ish) and accept losing `undoSelection`, or move
   underline to another chord.
3. **Windows has no redo chord.** `historyKeymap` binds
   `{key: "Mod-y", mac: "Mod-Shift-z"}` plus a **linux-scoped** `Ctrl-Shift-z`.
   macOS gets ⌘⇧Z, Linux gets both — **Windows gets Ctrl-Y only**, so
   Ctrl+Shift+Z genuinely does nothing there. Add it explicitly.
4. **In a live collab session, ⌘Z undoes other people's edits.** ySync dispatches
   remote peers' changes with only `ySyncAnnotation` and never
   `Transaction.addToHistory.of(false)`, and `historyField.update` only skips a
   transaction when `addToHistory === false`. Remote edits therefore enter your
   local undo stack. This is a multi-user data-integrity bug, not a nuisance —
   it belongs with the collab work in P0-2 if it proves awkward here.

**Acceptance.** Type, switch tabs, return, ⌘Z undoes; ⌘⇧Z redoes; the mode toggle
no longer clears history; ⌘E does not switch views; redo works on Windows chords;
e2e covers each and fails without the fix.

---

## P1-4 — Wikilink clicks open a new tab instead of navigating in place

**Status:** ✅ DONE 2026-08-16. Per-pane history now holds whole `Tab` entries,
so Back can put back a tab a link navigated away from; `openTab(tab, {replace})`
takes over the active tab (never a pinned one, never a tab already open);
live-preview and reading-view clicks pass `{newTab: meta||ctrl}` so ⌘-click still
opens a second tab. `renameTab` renames history copies too. Arrows moved from the
tab strip to the left column of the note header, as requested — note that
graph/canvas/empty panes therefore have no arrows, only ⌘[ / ⌘] and the palette.
5 e2e in `link-navigation.spec.ts`; the in-place and rename fixes each verified
by reverting them.

**Reproduction (live).** Pane has 1 tab. Click the `[[Type Systems]]` wikilink →
2 tabs. Every link follow adds a tab, forever.

**Root cause.** All three terminal branches of `navigate()`
(`editor-pane.tsx:265-292`) call `openTab`, which appends
(`workspace-store.ts:234-236`).

**Fix — Part 1, navigate in place.**
- Make per-pane history entries **self-describing** so an entry can be
  re-materialized after its tab is gone. Use `Tab[]` as the element type rather
  than inventing a parallel interface.
- `openTab(tab, {replace: true})` replaces the active tab in place, preserving
  its position; link follows and reading-view links use it. ⌘-click / middle
  click keep today's new-tab behaviour as the explicit gesture.
- **Never replace a pinned tab** — open a new one, as Obsidian does.
- If the target is already open in the same pane, activate that tab instead of
  duplicating.

**Corrections carried from the adversarial review:**
- `navigateBack/Forward` must handle a pane with **no active tab** (empty pane)
  or it crashes as originally specified.
- Back can now materialize a note that **no longer exists** (deleted, not merely
  closed). Handle the 404 rather than restoring a dead tab.
- `renameTab` updates `Tab.title` across panes but would not touch history
  copies, so Back would restore a stale title.
- There is a **third** back/forward surface beyond the arrows and ⌘[ / ⌘]: the
  command palette registers nav commands. All three must share one code path.

**Fix — Part 2, move back/forward next to the breadcrumb.** The arrows live in
`tab-bar.tsx` (`NavArrows`). The editor header is the requested home (immediately
left of the breadcrumb) — but note that an **empty pane renders `EmptyState`
with no header at all**, and graph/canvas tabs have no breadcrumb either. Put the
arrows in a header that renders for *every* pane content type, so they never
vanish.

**Acceptance.** Following ten links leaves one tab; back/forward walk the trail
including through a deleted note; a pinned tab is never replaced; ⌘-click still
opens a new tab; arrows are present and working on note, graph and empty panes.

---

## P2-5 — "Table" in the right-click menu is greyed out and unclickable

**Status:** ✅ DONE 2026-08-15 (`0fe2434`). Table group ungated with "Insert
table" first; the 13 table ops disable individually; sub-triggers gained the
`data-disabled` tokens so every disabled submenu app-wide now greys honestly;
`caretInTable` requires a delimiter row; `insertTable` appends instead of
replacing the selection. Verified live and both new e2e cases fail when
reverted.

**Reproduction (live).** Right-click in ordinary prose: `Table` and
`Sort & filter lines` report `disabled: true`. Inserting a table is only
reachable from `Insert ▸ Table`, which is not where anyone looks.

**Root cause — two facts combine, and one hypothesis is refuted.**
1. The real defect: the vendored shadcn `ContextMenuSubTrigger`
   (`ui/context-menu.tsx:114`) carries **no `data-disabled:*` classes**, unlike
   `ContextMenuItem` (`:93`). Radix disables the row behaviourally — non-focusable,
   no hover open, `onClick` returns early — but it still *looks* enabled. So it
   reads as "broken", not as "unavailable".
2. `editor-context-menu.tsx:347` gates the whole group on `caretInTable`.
3. **Refuted:** `caretInTable` is *not* broken under live preview. It is,
   however, too permissive — `isRow` accepts any pipe-fenced line with no
   delimiter row, which is destructive when the table commands then rewrite it.

**Fix.**
1. Append `data-disabled:pointer-events-none data-disabled:opacity-50` to
   `ContextMenuSubTrigger` and the dropdown equivalent. This alone fixes every
   disabled submenu app-wide, including `Sort & filter lines`.
2. Ungate the Table group; make `Insert table` its first entry; disable the 11
   row/column/align/sort/format items individually on `!ctx.inTable`.
3. Tighten `caretInTable` to require a delimiter row.
4. **Footgun to avoid:** `insertBlock` replaces the selection
   (`format-commands.ts:268`). Promoting table insertion to the top of a group
   makes it much easier to hit with text selected. Make insertion
   selection-safe.

**Acceptance.** Right-click in prose → Table opens, Insert table works, row/col
ops visibly greyed; a disabled submenu is visibly greyed everywhere; inserting a
table with text selected does not delete it.

---

## P1-8 — Editable tables in live preview (NEW, requested)

**Status:** ✅ CORE DONE 2026-08-15 (`5fbd5e9`). You now type directly into the
rendered table, with Add/Delete row and column controls and Tab navigation. Each
keystroke is a minimal change over that cell's span — one cell moves, the rest
of the table is byte-identical. Verified live (typed "ematics" into a cell,
added a row, added a column, deleted a row, each confirmed in postgres) and
covered by 9 e2e; the canary reads "Mathse" instead of "Mathsematics" when
widget DOM reuse is broken.

Deferred from the spec, none of them blocking: per-cell undo isolation
(`isolateHistory`), grid paste of tab-separated text, arrow-key navigation
between cells, a Move-row command, and remote-caret tints inside a table under
collab.

The maintainer's requirement: "once you insert the table, the user should see
the real table structure and edit inside, and if possible user should be able to
add more column, rows, delete, rows etc."

Today `block-widgets.ts` renders a table as a READ-ONLY widget that swaps back
to raw markdown when the selection touches it. The row/column/align/sort
commands all exist in `table-commands.ts` and operate on the source — they
should be reused, not reimplemented.

The hard parts, all of which the design must answer explicitly: keeping caret
focus alive when a cell edit rebuilds the decoration set (`updateDOM`/`eq`),
mapping a cell edit to a MINIMAL source range rather than rewriting the block,
undo granularity, and resolving the contradiction that the current reveal rule
would make the widget vanish exactly when the user clicks into it.

Three independent architectures were designed and judged. The winner is the
in-widget editable table (contenteditable cells, minimal-span writeback); the
full spec is in `tasks/nodum-editable-table-spec.md`, decomposed into 9
independently mergeable steps.

The decisive finding: `DocView.updateSelection` early-returns while a cell holds
focus, and `DOMObserver.readMutation` returns null for widget mutations, so the
caret genuinely cannot be stolen — the approach is safe by construction rather
than by careful bookkeeping. The two losing designs were rejected for concrete
reasons: a live-row grid shows raw pipes (not "editing inside a table") and runs
two parsers that disagree; a pinned React overlay desynchronises on async image
layout and stores an inverted cell mapping that throws on `insertTable`'s own
output.

**Step 1 ✅ (`0a28315`)** — one parser, `table-model.ts`. Shipped alone because
it fixed live corruption: an escaped pipe parsed as an extra column in all three
splitters, and the row/column commands rewrote tables around it.

Steps 2-9 outstanding: command API surface, widget identity, read-path widget,
contenteditable cells + commit, controls, keyboard/IME/paste, `insertTable`
opening a cell, then flag + styling + tests.

---

## P2-6 — Graph view: no control for node label font size

**Status:** ✅ DONE 2026-08-16. "Text size" slider (0.3–3, default 0.6) in
Display, folded into the render loop's zoom-adaptive font size exactly as
`nodeSize` folds into `pointSizeScale`; default node size dropped to 0.5.
Alongside it (requested live): hovering a file row or an editor link breathes
that note's node — additive, nothing dims — via `lib/graph/hover-bus.ts`. Also
fixed the label legibility shadow, which named `--ob-bg` (a Tailwind alias, not
a CSS variable) and computed to `none`. e2e: `graph.spec.ts` text size,
`graph-hover.spec.ts` ×2.

**Reproduction (live).** Graph settings exposes 7 sliders; none affects label
size.

**Root cause.** Not a defect — a missing feature. cosmos.gl renders **no text**;
labels are a hand-rolled absolutely-positioned DOM overlay whose `fontSize` is
seeded to `10px` (`graph-view.tsx:642-646`) and scaled by zoom in the RAF tick
(`:717-731`). `.nodum-graph-label` deliberately declares no `font-size` so it
inherits the overlay's.

**Fix.** A `labelSize` multiplier folded into the existing zoom-adaptive
calculation exactly as `nodeSize` folds into `pointSizeScale`. `ForceSlider`,
Display section, after "Node size", range 0.6–2.5 step 0.1, default 1. Nine
mechanical edits in `graph-view.tsx`, all mirroring the `nodeSize` precedent
(`PersistedGraph`, `GRAPH_DEFAULTS`, draft state, fallback chain,
`resetToDefaults`, `touched`, `settingsJson`, persist patch, tick).

**Also worth doing while in here** (from `docs/research/obsidian-graph-spec.md`,
which the triage flagged as unconsulted): Obsidian's Display section also has a
**text fade threshold**, and its label size is per-node (`14 + radius/4`). The
label `y + 9` offset does not scale with `sizeScale` and is already slightly
wrong at high zoom.

**Acceptance.** Slider changes label size live, persists across reload, resets
with the other defaults; e2e asserts a measured font-size change.

---

## P3-7 — Release v3.3.0

Only after P0/P1 land. Check migrations, prod compose smoke, secrets, and the
`docs/collab.md` correction from P0-2. `dev` → `main`, tag, prod-compose smoke.

---

## Sequence

| # | Item | Effort | Why here |
|---|------|--------|----------|
| 0 | ~~Disable collab on the demo vault~~ → fixed the leak instead (`fc8428e`) | S | ✅ Root cause removed rather than masked |
| 1 | ~~P2-5 table menu + disabled styling~~ (`0fe2434`) | S | ✅ Done |
| 2 | ~~P0-1 inline HTML~~ (`0988105`) | M | ✅ Done |
| 3 | P1-3 undo/redo (stages A→C) | L | Core editing safety |
| 4 | ~~P1-4 link navigation + arrows~~ | L | ✅ Done 2026-08-16 |
| 5 | ~~P2-6 graph label size~~ (+ hover pulse) | S | ✅ Done 2026-08-16 |
| 6 | P0-2 collab R1/R2/R3 | M | Blocker only if collab ships enabled |
| 7 | P3-7 release | S | Last |

Item 0 first because it is one line and removes an active data-loss risk. Item 1
before item 2 because it is small and builds the branch/test rhythm.
