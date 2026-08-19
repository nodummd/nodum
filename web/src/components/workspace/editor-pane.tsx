"use client";

/**
 * Editor pane — inline title, mode toggle (live / source / reading),
 * CodeMirror 6 body with debounced autosave and wikilink navigation.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookOpen, Code2, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { AttachmentPreview, isAttachmentTarget } from "@/components/editor/attachment-preview";
import { PagePreview, usePagePreview } from "@/components/editor/page-preview";
import { ShareButton } from "./share-button";
import { VersionHistoryDialog } from "./version-history";
import { createCollabSession, presenceColor, type CollabSession } from "@/lib/editor/collab";
import { getAccessToken } from "@/lib/api/client";
import { useAuthStore } from "@/lib/stores/auth-store";
import { vaultApi } from "@/lib/api/endpoints";
import { EditorView } from "@codemirror/view";

import { ReadingView } from "@/components/editor/reading-view";
import { BacklinksInDocument } from "./backlinks-in-document";
import { NavArrows } from "./nav-arrows";
import { NoteBreadcrumb } from "./note-breadcrumb";
import { NoteMenu } from "./note-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import { bookmarkApi, noteApi, searchApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";
import { currentActiveNote, setActiveNote, setNoteHover } from "@/lib/graph/hover-bus";
import { useEditorSettings } from "@/lib/hooks/use-editor-settings";
import { resolveNewNoteFolder } from "@/lib/new-note-location";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

export function EditorPane({
  vaultId,
  noteId,
  paneIndex,
}: {
  vaultId: string;
  noteId: string;
  paneIndex: number;
}) {
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const { data: note, error } = useQuery({
    queryKey: ["note", vaultId, noteId],
    queryFn: () => noteApi.get(vaultId, noteId),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    gcTime: 60_000, // full note bodies are heavy — drop quickly once unused
  });

  // Persisted workspace tabs can outlive their notes — prune on 404.
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404) closeTab(noteId);
  }, [error, closeTab, noteId]);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ob-faint">Loading…</div>
    );
  }

  // key remounts the body when switching notes — local draft state resets
  // naturally without effect-based syncing.
  return <EditorBody key={noteId} vaultId={vaultId} note={note} paneIndex={paneIndex} />;
}

/** Heading text the way a link would spell it: no markdown markers, no case,
 *  collapsed whitespace. */
function normalizeHeading(text: string): string {
  return text
    .replace(/[*_`~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The document line of the first heading whose text matches — ATX or setext,
 *  never a `#` inside a fenced code block; a closing `#` run only counts when
 *  a space precedes it (CommonMark), so `## C#` keeps its name. */
function findHeadingLine(view: EditorView, heading: string): { from: number } | null {
  const want = normalizeHeading(heading);
  const doc = view.state.doc;
  let inFence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (/^\s{0,3}(```|~~~)/.test(line.text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const atx = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line.text);
    if (atx && normalizeHeading(atx[1]) === want) return { from: line.from };
    if (n < doc.lines && line.text.trim() && /^\s{0,3}(=+|-+)\s*$/.test(doc.line(n + 1).text)) {
      if (normalizeHeading(line.text) === want) return { from: line.from };
    }
  }
  return null;
}

function EditorBody({ vaultId, note, paneIndex }: { vaultId: string; note: Note; paneIndex: number }) {
  const queryClient = useQueryClient();
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const mode = useWorkspaceStore((s) => s.editorMode);
  const setMode = useWorkspaceStore((s) => s.setEditorMode);

  const versionsOpen = useWorkspaceStore((s) => s.versionsOpen);
  const setVersionsOpen = useWorkspaceStore((s) => s.setVersionsOpen);
  const editorSettings = useEditorSettings();
  const preview = usePagePreview();

  const [title, setTitle] = useState(note.title);
  const titleRef = useRef<HTMLInputElement>(null);
  // The live CodeMirror view, so the ⋯ menu can run editor commands.
  const editorViewRef = useRef<EditorView | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Obsidian's "Backlinks in document": the same list the right panel shows,
  // pinned under the note body instead of in the sidebar.
  const [backlinksInDocument, setBacklinksInDocument] = useState(false);
  // draft lives in state (render-safe) and a ref (event-safe for save callbacks)
  const [draft, setDraft] = useState(note.content);
  const draftRef = useRef(note.content);
  // bumped when content is replaced from outside the editor (version restore)
  // so the manually-mounted CodeMirror instance remounts with the new doc
  const [editorEpoch, setEditorEpoch] = useState(0);
  const baseUpdatedAt = useRef(note.updated_at);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The body we know is on the server. `draftRef !== lastSavedRef` is the
  // "there are unsaved keystrokes" test — including the window after the
  // debounce fires but before the save lands, which the timer ref alone cannot
  // express.
  const lastSavedRef = useRef(note.content);
  const conflictRetries = useRef(0);

  // ── Live collaboration (per-vault opt-in via settings.collabEnabled) ──────
  const user = useAuthStore((s) => s.user);
  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list });
  const collabEnabled = Boolean(
    (vaults?.find((v) => v.id === vaultId)?.settings as { collabEnabled?: boolean } | undefined)
      ?.collabEnabled,
  );
  // ref mirror for event callbacks (onChange/unmount flush); render reads
  // the state below — never the ref
  const collabRef = useRef<CollabSession | null>(null);
  // TRUE only once the socket has actually synced. collabRef holds a session
  // object from the moment it is constructed, so using it to decide "the server
  // is persisting for us" silently drops every keystroke when the socket never
  // connects. This ref is what the save paths must consult.
  const collabLiveRef = useRef(false);
  const [syncedSession, setSyncedSession] = useState<CollabSession | null>(null);
  // bumped when the socket drops post-sync → rebuild with a fresh doc
  const [collabEpoch, setCollabEpoch] = useState(0);
  useEffect(() => {
    if (!collabEnabled) return;
    const token = getAccessToken();
    if (!token) return;
    const session = createCollabSession(
      vaultId,
      note.id,
      token,
      {
        name: user?.name ?? "Someone",
        color: presenceColor(user?.email ?? note.id),
      },
      () => setCollabEpoch((n) => n + 1),
    );
    collabRef.current = session;
    const onSync = (synced: boolean) => {
      if (!synced) {
        collabLiveRef.current = false;
        return;
      }
      // A room that syncs EMPTY for a note that has content means the server
      // failed to seed it. Binding the editor to that document would show a
      // blank note and, worse, let collab persist the blank over the real one.
      // Refuse the session and stay on the local editor instead.
      const seeded = session.ytext.toString().length > 0;
      if (!seeded && note.content.trim().length > 0) {
        collabLiveRef.current = false;
        return;
      }
      collabLiveRef.current = true;
      setSyncedSession(session);
    };
    session.provider.on("sync", onSync);
    return () => {
      session.provider.off("sync", onSync);
      session.destroy();
      collabRef.current = null;
      collabLiveRef.current = false;
    };
    // user identity is stable within a mounted editor session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabEnabled, vaultId, note.id, collabEpoch]);
  // gate on the flag so a just-disabled vault never reuses a destroyed session
  const activeCollab = collabEnabled ? syncedSession : null;

  // If the collab socket never syncs (server down, rejected handshake, flaky
  // network) we must NOT leave the user staring at "Connecting…" with no way to
  // type. Give it a few seconds, then fall back to the ordinary local editor —
  // a note that saves over REST beats a note you cannot edit at all.
  // Only ever latches true (EditorBody is keyed by note id, so it resets when
  // you switch notes). Once collab does sync, activeCollab wins regardless.
  const [collabTimedOut, setCollabTimedOut] = useState(false);
  useEffect(() => {
    if (!collabEnabled || activeCollab) return;
    const timer = setTimeout(() => setCollabTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [collabEnabled, activeCollab, collabEpoch]);
  const waitingForCollab = collabEnabled && !activeCollab && !collabTimedOut;

  const save = useMutation({
    mutationFn: (content: string) =>
      noteApi.saveContent(vaultId, note.id, content, baseUpdatedAt.current),
    onSuccess: (saved: Note) => {
      conflictRetries.current = 0;
      baseUpdatedAt.current = saved.updated_at;
      lastSavedRef.current = draftRef.current;
      queryClient.setQueryData(["note", vaultId, note.id], { ...saved, content: draftRef.current });
      void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["outgoing", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
    },
    onError: async (err) => {
      // 409 = another tab/device saved first. Recovery: adopt the server's
      // timestamp and resubmit the local draft once (last-writer-wins, like
      // Obsidian). Without this the editor would 409 forever silently.
      if (err instanceof ApiError && err.status === 409 && conflictRetries.current < 2) {
        conflictRetries.current += 1;
        const details = err.details as { server_updated_at?: string } | undefined;
        // Only resubmit when there is something of the user's to resubmit.
        // Retrying a draft identical to what we already persisted just
        // overwrites whatever the other writer put there with a body the user
        // never edited — which is how a merge or template insert got silently
        // reverted.
        if (details?.server_updated_at && draftRef.current !== lastSavedRef.current) {
          baseUpdatedAt.current = details.server_updated_at;
          save.mutate(draftRef.current);
          return;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
    },
  });

  const onChange = useCallback(
    (content: string) => {
      draftRef.current = content;
      setDraft(content);
      // Only a LIVE collab session persists on our behalf; a session that never
      // connected must still autosave over REST or the work is lost.
      if (collabLiveRef.current) return;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // Nulling the ref inside the callback is what makes the external-write
      // adoption below work at all: it is gated on `saveTimer.current === null`,
      // and this ref used to stay truthy forever after the first keystroke.
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        save.mutate(content);
      }, 700);
    },
    [save],
  );

  // Flush a pending debounced save when the pane unmounts (tab close/switch) —
  // otherwise up to 700ms of typing would be lost.
  useEffect(() => {
    return () => {
      // A tab switch can retire the note out from under the pointer, which
      // fires no mouseleave — the graph would keep breathing a stale node.
      setNoteHover(null);
      // Same for focus: a closed editor is never "the note you are working in",
      // and removing a focused element fires no blur — ⌘W with the caret in the
      // text would otherwise leave the node breathing forever. Only clear our
      // own claim; the other pane may have taken over already.
      if (currentActiveNote() === note.id) setActiveNote(null);
      // Gate on the draft actually differing from what was persisted, not on
      // the timer alone. The timer ref used to never clear, so this fired a
      // second redundant saveContent on every tab close even when the debounced
      // save had already succeeded — racing it, with a now-stale base timestamp.
      if (
        !collabLiveRef.current &&
        draftRef.current !== lastSavedRef.current &&
        (saveTimer.current !== null || draftRef.current !== note.content)
      ) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void noteApi.saveContent(vaultId, note.id, draftRef.current, baseUpdatedAt.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rename = useMutation({
    mutationFn: (newTitle: string) => noteApi.rename(vaultId, note.id, { title: newTitle }),
    onSuccess: (meta) => {
      renameTab(note.id, meta.title);
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
    },
  });

  // ── Adopt content replaced from outside the editor ───────────────────────
  //
  // Merge, import and the clipper all write a note's body through the API. The
  // draft below is seeded once at mount and keyed by note id, so none of that
  // reaches an already-open editor: it keeps showing the pre-write body, and
  // the next keystroke autosaves that stale text back over the write.
  //
  // A cache subscription rather than an effect on `note`: this reacts to an
  // event, so the state update never happens during render.
  useEffect(() => {
    const key = `["note","${vaultId}","${note.id}"]`;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || JSON.stringify(event.query.queryKey) !== key) return;
      const next = (event.query.state.data as Note | undefined)?.content;
      if (next === undefined || next === draftRef.current) return;
      // Never clobber unsaved keystrokes, and stay out of collab's way — a live
      // room already receives external writes through its own reset channel.
      // The second clause covers the in-flight window: between the debounce
      // firing and onSuccess landing there is no timer, but the draft is not
      // persisted yet either.
      if (
        saveTimer.current !== null ||
        draftRef.current !== lastSavedRef.current ||
        collabLiveRef.current
      )
        return;
      draftRef.current = next;
      lastSavedRef.current = next;
      setDraft(next);
      baseUpdatedAt.current = (event.query.state.data as Note).updated_at;
      // Remount CodeMirror: its document is independent of `draft` after mount.
      setEditorEpoch((n) => n + 1);
    });
  }, [queryClient, vaultId, note.id]);

  // [[Note#Heading]]: once this note is the one asked for, scroll its editor
  // (or reading view) to the heading. Retried over a few frames because the
  // editor may still be mounting when the request lands.
  const pendingHeading = useWorkspaceStore((s) => s.pendingHeading);
  useEffect(() => {
    if (!pendingHeading || pendingHeading.noteId !== note.id) return;
    const { heading, nonce } = pendingHeading;
    const started = performance.now();
    let frame = 0;
    const attempt = (): boolean => {
      const view = editorViewRef.current;
      if (view) {
        const line = findHeadingLine(view, heading);
        if (line === null) return false;
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }),
          scrollIntoView: false,
        });
        return true;
      }
      const reading = bodyRef.current?.querySelector(".nodum-reading");
      if (reading) {
        const want = normalizeHeading(heading);
        const el = Array.from(reading.querySelectorAll("h1,h2,h3,h4,h5,h6")).find(
          (h) => normalizeHeading(h.textContent ?? "") === want,
        );
        if (!el) return false;
        el.scrollIntoView({ block: "start" });
        return true;
      }
      return false;
    };
    // A time budget rather than a frame count: a collab-enabled note shows
    // "Connecting live session…" for up to 4 s before its editor exists.
    const tick = () => {
      if (attempt() || performance.now() - started > 6000) {
        useWorkspaceStore.getState().clearPendingHeading(nonce);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
    // activeCollab/waitingForCollab: the effect restarts when the editor that
    // will actually stay on screen mounts (the local one is replaced by the
    // collab-keyed one once the session syncs).
  }, [pendingHeading, note.id, activeCollab, waitingForCollab]);

  /** Follow a [[wikilink]]: open by path/title, or create the note (Obsidian behavior).
   *  A plain click reads the note in THIS tab; ⌘/Ctrl-click opens another one.
   *  A `heading` ([[Note#Heading]]) is handed to whichever pane shows the note,
   *  which scrolls to it once the editor is on screen. */
  const navigate = useCallback(
    async (target: string, opts?: { newTab?: boolean; heading?: string }) => {
      const open = (tab: { id: string; kind: "note"; title: string }) => {
        openTab(tab, { adoptDefaultMode: false, replace: !opts?.newTab });
        if (opts?.heading) useWorkspaceStore.getState().setPendingHeading(tab.id, opts.heading);
      };
      try {
        const found = await noteApi.getByPath(vaultId, target);
        open({ id: found.id, kind: "note", title: found.title });
        return;
      } catch {
        /* not an exact path — resolve by title below */
      }
      const candidates = await searchApi.quickSwitch(vaultId, target, 5);
      const exact = candidates.find((c) => c.title.toLowerCase() === target.toLowerCase());
      if (exact) {
        open({ id: exact.id, kind: "note", title: exact.title });
        return;
      }
      // A pathless ghost link honors the vault's default new-note location;
      // an explicit [[Folder/Note]] path keeps its own placement (title-as-path).
      const created = await noteApi.create(vaultId, {
        title: target,
        folder_path: target.includes("/")
          ? undefined
          : resolveNewNoteFolder(queryClient, vaultId, note.path),
      });
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      open({ id: created.id, kind: "note", title: created.title });
    },
    [vaultId, openTab, queryClient, note.path],
  );

  return (
    <div
      ref={bodyRef}
      className="flex h-full flex-col"
      // "The note you are working in" for the graph's breathing highlight — it
      // means the caret is HERE, so it starts when focus enters this pane and
      // ends the moment focus leaves it (or the tab closes, below).
      onFocus={() => setActiveNote(note.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setActiveNote(null);
      }}
    >
      {/* Three columns so the breadcrumb stays optically centred no matter how
          wide the button cluster gets. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-1.5">
        <div className="flex items-center justify-start">
          <NavArrows paneIndex={paneIndex} />
        </div>
        <NoteBreadcrumb
          vaultId={vaultId}
          note={note}
          onRename={(next) => {
            setTitle(next);
            rename.mutate(next);
          }}
        />
        <div className="flex items-center justify-end gap-0.5">
        <BookmarkButton vaultId={vaultId} noteId={note.id} />
        <ShareButton vaultId={vaultId} noteId={note.id} />
        <ModeButton
          label="Live preview"
          active={mode === "live"}
          onClick={() => setMode("live")}
          icon={<Pencil className="size-3.5" strokeWidth={1.75} />}
        />
        <ModeButton
          label="Source mode"
          active={mode === "source"}
          onClick={() => setMode("source")}
          icon={<Code2 className="size-3.5" strokeWidth={1.75} />}
        />
        <ModeButton
          label="Reading view"
          active={mode === "reading"}
          onClick={() => setMode("reading")}
          icon={<BookOpen className="size-3.5" strokeWidth={1.75} />}
        />
        <NoteMenu
          vaultId={vaultId}
          note={note}
          paneIndex={paneIndex}
          getEditorView={() => editorViewRef.current}
          onRenameRequest={() => {
            // After the menu's close-focus pass, or it lands on the trigger.
            requestAnimationFrame(() => {
              titleRef.current?.focus();
              titleRef.current?.select();
            });
          }}
          backlinksInDocument={backlinksInDocument}
          onToggleBacklinksInDocument={() => setBacklinksInDocument((v) => !v)}
        />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        {...preview.handlers}
        // Hovering a link points the open graph at the note it leads to (the
        // node breathes). Wraps the page-preview handler rather than replacing
        // it — the preview has its own "require ⌘" pref, this never should.
        onMouseOver={(e) => {
          preview.handlers.onMouseOver(e);
          const el = (e.target as HTMLElement).closest?.("[data-wikilink-target]");
          const target = el?.getAttribute("data-wikilink-target");
          setNoteHover(target ? { target } : null);
        }}
        onMouseLeave={() => setNoteHover(null)}
      >
        <div
          // Printing (our "Export to PDF…") shows only this subtree — see the
          // @media print block in globals.css.
          data-print-root
          className={cn(
            "mx-auto min-h-full px-4 pt-4 pb-24 md:px-8",
            editorSettings.readableLineLength ? "max-w-[44rem]" : "max-w-none",
          )}
          style={
            {
              "--editor-font-size": `${editorSettings.editorFontSize}px`,
              fontSize: "var(--editor-font-size)",
            } as React.CSSProperties
          }
        >
          <input
            ref={titleRef}
            value={title}
            aria-label="Note title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim();
              if (t && t !== note.title) rename.mutate(t);
              else setTitle(note.title);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="mb-4 w-full bg-transparent text-[1.802em] leading-tight font-bold text-ob-text outline-none focus-visible:outline-none"
          />
          {mode === "reading" ? (
            <ReadingView content={draft} vaultId={vaultId} onNavigate={(t, opts) => void navigate(t, opts)} />
          ) : waitingForCollab ? (
            <p className="pt-2 text-[13px] text-ob-faint">Connecting live session…</p>
          ) : (
            <MarkdownEditor
              key={activeCollab ? `collab-${note.id}-${collabEpoch}` : editorEpoch}
              vaultId={vaultId}
              historyKey={`${paneIndex}:${note.id}`}
              initialContent={draft}
              mode={mode}
              onChange={onChange}
              onNavigate={(t, opts) => void navigate(t, opts)}
              collab={activeCollab ?? undefined}
              showLineNumbers={editorSettings.showLineNumbers}
              spellcheck={editorSettings.spellcheck}
              onViewReady={(v) => {
                editorViewRef.current = v;
              }}
            />
          )}
          {backlinksInDocument && (
            <BacklinksInDocument
              vaultId={vaultId}
              noteId={note.id}
              onOpen={(id, t) => openTab({ id, kind: "note", title: t })}
            />
          )}
        </div>
      </div>
      {preview.anchor &&
        (isAttachmentTarget(preview.anchor.target) ? (
          <AttachmentPreview
            vaultId={vaultId}
            target={preview.anchor.target}
            x={preview.anchor.x}
            y={preview.anchor.y}
            onEnter={preview.cancelClose}
            onLeave={preview.scheduleClose}
          />
        ) : (
          <PagePreview vaultId={vaultId} anchor={preview.anchor} />
        ))}
      <VersionHistoryDialog
        vaultId={vaultId}
        noteId={note.id}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        onRestored={(restored) => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = null;
          draftRef.current = restored.content;
          // Without this the pane looks permanently dirty and would refuse
          // every subsequent external write for the rest of its life.
          lastSavedRef.current = restored.content;
          setDraft(restored.content);
          baseUpdatedAt.current = restored.updated_at;
          setEditorEpoch((n) => n + 1);
          queryClient.setQueryData(["note", vaultId, note.id], restored);
          void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
          void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
          void queryClient.invalidateQueries({ queryKey: ["tags", vaultId] });
        }}
      />
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "flex size-6 items-center justify-center rounded transition-colors duration-150",
            active ? "bg-ob-active text-ob-text" : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}


function BookmarkButton({ vaultId, noteId }: { vaultId: string; noteId: string }) {
  const queryClient = useQueryClient();
  const { data: bookmarks } = useQuery({
    queryKey: ["bookmarks", vaultId],
    queryFn: () => bookmarkApi.list(vaultId),
  });
  const isBookmarked = bookmarks?.some((b) => b.note_id === noteId) ?? false;

  const toggle = useMutation({
    mutationFn: () =>
      isBookmarked ? bookmarkApi.remove(vaultId, noteId) : bookmarkApi.add(vaultId, noteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["bookmarks", vaultId] }),
  });

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this note"}
          aria-pressed={isBookmarked}
          onClick={() => toggle.mutate()}
          className={cn(
            "flex size-6 items-center justify-center rounded transition-colors duration-150",
            isBookmarked ? "text-ob-accent" : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
          )}
        >
          <Bookmark className="size-3.5" strokeWidth={1.75} fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{isBookmarked ? "Remove bookmark" : "Bookmark"}</TooltipContent>
    </Tooltip>
  );
}
