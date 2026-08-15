"use client";

/**
 * "The pointer is on this note" channel, shared by the surfaces that name notes
 * (file explorer rows, editor links) and the graph, which highlights the node.
 *
 * A plain module emitter rather than store state: the pointer crosses dozens of
 * rows a second, and each crossing must nudge one WebGL node — not re-render the
 * workspace. Nothing here is persisted; it is pure pointer state.
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
