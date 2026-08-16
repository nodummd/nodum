"use client";

/**
 * Two channels the graph listens to, both about "which note is the user on":
 *
 *  - HOVER: the pointer is on this note somewhere in the app (a file explorer
 *    row, a link in a note).
 *  - ACTIVE: the caret is in this note's editor — you are working in it right
 *    now. It ends the moment focus leaves that editor, or the editor closes.
 *
 * Plain module emitters rather than store state: the pointer crosses dozens of
 * rows a second, and each crossing must nudge one WebGL node — not re-render the
 * workspace. Nothing here is persisted; it is pure interaction state.
 */

export interface NoteHover {
  /** Note id — the explorer knows it outright. */
  id?: string;
  /** A wikilink target: a title, or a `Folder/Sub/Title` path. Resolved the way
   *  the backend resolves links (title first, then path), so a link and the
   *  file it points at highlight the same node. */
  target?: string;
}

type Listener = (hover: NoteHover | null) => void;

const listeners = new Set<Listener>();
let current: NoteHover | null = null;

function same(a: NoteHover | null, b: NoteHover | null): boolean {
  return a?.id === b?.id && a?.target === b?.target;
}

export function setNoteHover(hover: NoteHover | null): void {
  if (same(current, hover)) return;
  current = hover;
  for (const listener of listeners) listener(hover);
}

export function subscribeNoteHover(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The hover in effect right now — lets a graph that mounts (or re-applies its
 *  data) mid-hover pick the highlight up without waiting for the next move. */
export function currentNoteHover(): NoteHover | null {
  return current;
}

// ── Active note: the editor the caret is actually in ──────────────────────────

type ActiveListener = (noteId: string | null) => void;

const activeListeners = new Set<ActiveListener>();
let activeNoteId: string | null = null;

/** Called by an editor when focus enters it (id) or leaves it (null). */
export function setActiveNote(noteId: string | null): void {
  if (activeNoteId === noteId) return;
  activeNoteId = noteId;
  for (const listener of activeListeners) listener(noteId);
}

export function subscribeActiveNote(listener: ActiveListener): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

export function currentActiveNote(): string | null {
  return activeNoteId;
}
