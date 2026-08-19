# GOAL — Multiple vaults, and a bring-your-own-key AI (Aug 2026)

Working document for the current mandate. Two features, in order: **A. multiple
vaults** (each a complete, separate workspace; switching opens a new browser
tab), then **B. AI** (own API key in settings, and a chat that can write into the
vault).

Companion to `tasks/nodum-master-plan.md`; log outcomes there as items land.
Successor to `tasks/nodum-editor-fixes-goal.md`, which is complete except for the
carried-over items listed at the bottom.

## Working rules (carried forward — they have already paid for themselves)

1. **Reproduce before fixing / verify before claiming.** Every behaviour claim is
   checked live at `localhost:3100` (demo@vorreix.com / demopass123).
2. **Prove the test is not vacuous.** After writing a test, revert the fix and
   watch it fail.
3. **No speculative changes.** If it cannot be demonstrated, do not "fix" it.
4. One item per feature branch, merged `--no-ff` to `dev`, pushed.
5. `cd web && npm run lint && npm run build` on every frontend change;
   `uv run pytest tests/unit tests/integration && uv run ruff check .` on every
   backend change. Full Playwright before merge.
6. **Never commit a secret.** This repo is public. New env vars land in
   `deploy/.env.example` with placeholders only.

---

# A. Multiple vaults

**The backend is already done.** Recon confirmed: `vaults` is a plain user-owned
table (unique `user_id+name`, cap `MAX_VAULTS_PER_USER = 20`), every child table
carries `vault_id ON DELETE CASCADE`, and all ~45 vault-scoped service calls go
through `vault_service.get_owned_vault`. `vaultApi.create` / `.update` / `.remove`
all exist in `web/src/lib/api/endpoints.ts` and are **never called**. Nothing on
the backend assumes one vault per user.

Everything missing is frontend.

## A1 — Per-vault workspace layout ✅ DONE 2026-08-16 (`cbac7a7`)

**The problem.** `panes` (open tabs, holding note ids from ONE vault) is persisted
globally in `localStorage["nodum-workspace"]` next to `activeVaultId`
(`workspace-store.ts`). Two browser tabs on two vaults both write that record
continuously, last write wins, and `setActiveVault` wipes `panes` whenever the id
changes — so tab A loses its open notes the moment tab B loads.

**The fix.** Partition the persisted layout by vault id and make writes merge
instead of clobber:

- Persist `layouts: Record<vaultId, {panes, activePane}>` alongside the global
  chrome (sidebar widths, ribbon, sort, editorMode).
- A custom zustand `PersistStorage` that **read-modify-writes**: on `setItem`,
  re-read the stored record and replace only the entry for *this tab's* vault.
  Two tabs on different vaults then cannot destroy each other's layout.
- `setActiveVault` swaps the layout in rather than wiping it.
- Clear the vault-scoped transient state a switch leaves stale:
  `graphFocusNoteId`, `revealTarget`, `searchSeed` all hold ids from the old
  vault.

**Acceptance.** Open vault A with three tabs, open vault B in a second browser
tab and work there, return to A and reload: A still has its three tabs. Verified
by e2e driving two `BrowserContext` pages.

## A2 — Vault switcher, and switching opens a new tab ✅ DONE 2026-08-16

- The static vault-name caption (`sidebar-left.tsx:83`) becomes a dropdown: every
  vault, a checkmark on the current one, `New vault…`, `Manage vaults…`.
- Picking another vault calls
  `window.open('/vault/<id>', '_blank', 'noopener,noreferrer')` **synchronously
  inside the click handler** — anything awaited first gets popup-blocked. The
  vault list is already in the `["vaults"]` query, so nothing needs awaiting.
- `document.title = vault.name` so two open tabs are distinguishable. This is the
  main UX cost of the new-tab model and it is one effect.
- `<Workspace key={vaultId}>` so an in-tab id change remounts cleanly (CodeMirror
  drafts, collab sockets, plugin host).
- Fix the dead `Change vault…` palette command (`command-palette.tsx:287`), which
  today `router.push("/vault")` → dispatcher → straight back to the same vault.

## A3 — Create / rename / delete a vault ✅ DONE 2026-08-16

Settings → **Vault** tab grows a vault list at the top: rename inline, delete with
`confirmDelete()` (the backend cascade-deletes everything — say so), create.
Never offer to delete the last vault; the backend has no such guard and a user
with zero vaults hits the dispatcher's dead end.

Creating a vault opens it in a new tab, same as switching.

**Acceptance for A.** Two vaults, two browser tabs, independent tab strips and
independent graphs; renaming shows everywhere; deleting cascades and cannot
orphan the user.

---

# B. AI — your key, your model, your responsibility

Explicitly user-owned: their key, their spend, their terms with the provider. The
UI says so plainly, once, where the key is entered.

## B1 — Encrypted credentials + settings tab ✅ DONE 2026-08-16 (`59d15eb`)

**Where the key must NOT go.** `users.settings` is echoed to the browser in full
on signup, login, refresh, `GET /auth/me` and every `PATCH /auth/me` response —
and `PATCH /auth/me` accepts an unvalidated `dict[str, Any]` and shallow-merges
it. A key there would round-trip on every auth call and be client-writable. So:

**Backend**
- `cryptography` declared explicitly in `back/pyproject.toml` (present today only
  transitively via `python-jose[cryptography]` — the same transitive-dependency
  mistake this project already refused once).
- `AI_ENCRYPTION_KEY` as its own setting — **not** `SECRET_KEY`, which is
  currently referenced by nothing and which operators may reasonably rotate;
  binding recoverable ciphertext to it would turn a harmless rotation into
  silent data loss. Production refuses to boot on a placeholder.
- `app/utils/crypto_utils.py`: `encrypt_secret` / `decrypt_secret`, Fernet, with
  a **version prefix** in the stored blob so the key can ever be rotated.
- Model `AICredential` (`user_id`, `provider`, `key_ciphertext`, `model`,
  `base_url?`), unique on `(user_id, provider)`; migration `0014_ai_credentials`.
  `base_url` is a real feature (self-hosted and regional endpoints) and is what
  lets the e2e point a provider at a local stub.
- `app/api/v1/ai.py`: `GET /ai/status`, `PUT /ai/credentials`,
  `DELETE /ai/credentials/{provider}`, `POST /ai/test`. **No endpoint ever
  returns the key** — status returns `{configured, provider, model}` and a
  masked hint at most.

**Frontend** — Settings → **AI** tab (its own component file; the modal is 874
lines already): provider (Anthropic / OpenAI / Gemini / Qwen), key input, model
picker with a per-provider list plus free text, Save / Test / Remove.

**Acceptance.** Key saves; `GET /ai/status` says configured; the plaintext key
appears in **no** API response; the DB column is ciphertext (asserted directly);
another user cannot read it; Test reports success/failure honestly.

## B2 — AI chat panel ✅ DONE 2026-08-16 (`5f71571`)

Right sidebar gains an `"ai"` pane (`RightPaneKind` + `sidebar-right.tsx` +
palette command + ribbon). Chat against the configured provider through the
backend (the key never reaches the browser).

**Unconfigured is a first-class state, not an error.** Opening AI without a key
shows a short explainer and a button that opens Settings → AI — exactly what the
mandate asks for.

## B3 — The AI can write into the vault ✅ DONE 2026-08-16 (`5f71571`)

Tools, server-side, provider-adapted (Anthropic `tools`, OpenAI/Qwen `tools`,
Gemini `functionDeclarations`):
- `search_notes(query)` — so answers are grounded in the vault
- `create_note(title, content, folder?)` — honours the vault's new-note location
- `link_note(target)` — insert a `[[wikilink]]` into the note being viewed

Every write is surfaced in the transcript as a card ("Created **Note** →" with a
click-through), never silently.

**Acceptance.** With a stub provider, a chat turn that calls `create_note`
creates it in the tree and links it; with no key the panel shows the gate; the
key never appears in a browser payload.

---

## Sequence

| # | Item | Effort | Why here |
|---|------|--------|----------|
| 1 | ~~A1 per-vault layout~~ | M | ✅ Done 2026-08-16 |
| 2 | ~~A2 switcher + new tab~~ | M | ✅ Done 2026-08-16 |
| 3 | ~~A3 create/rename/delete~~ | S | ✅ Done 2026-08-16 |
| 4 | ~~B1 encrypted keys + settings~~ | L | ✅ Done 2026-08-16 |
| 5 | ~~B2 chat panel + gate~~ | M | ✅ Done 2026-08-16 |
| 6 | ~~B3 vault-writing tools~~ | L | ✅ Done 2026-08-16 |

| 7 | ~~B4 saved chat history~~ | M | ✅ Done 2026-08-16 (`a974128`) |

Both features are complete. **B4 (added after the fact):** chats are stored per
vault in `ai_conversations` / `ai_messages` (migration 0015). The client sends
only the new message and the server rebuilds the transcript from its own rows,
so history survives reloads and devices and a client cannot rewrite what the
model was told. A failed turn rolls back rather than leaving a half-written
thread.

Streaming replies (`feature/4.ai-streaming`) and per-vault AI keys (`feature/5.ai-vault-keys`) landed 2026-08-19 — see `tasks/nodum-release-cycle-goal.md`.

## Carried over from the previous goal doc

- **P0-2 collab under `--workers 4`** — cross-worker fanout is broken and each
  worker's persist loop overwrites the whole doc every 3s. Collab is enabled on
  the demo vault. Still open; `docs/collab.md` also needs correcting.
- **P1-3 undo/redo** — history is destroyed on tab switch; staged plan in the old
  doc (Compartment → redo chords → per-(pane,note) historyField snapshots).
- **P1-8 editable tables steps 6-9** — per-cell undo isolation, grid paste,
  arrow-key cell navigation, Move-row, remote-caret tints.
- `switcher-extras.spec.ts` ⌘Enter and `split-panes.spec.ts` ⌘\ each flake ~1 run
  in 3.
