"use client";

/**
 * The signed-in decoration layer for community pages, as one context per
 * page: a provider fetches the viewer-decorated payload ONCE (never one
 * request per row) and small leaf components consume it beside the
 * server-rendered content. Anonymous viewers cost zero extra requests.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { api, apiJson } from "@/lib/api/client";
import { useAuthStore } from "@/lib/stores/auth-store";

// ── Thread: likes + the read beacon ──────────────────────────────────────────

interface ThreadViewerState {
  liked: Set<string>;
  toggle: (postId: string) => Promise<{ like_count: number; liked: boolean } | null>;
}

const ThreadContext = createContext<ThreadViewerState | null>(null);

export function ThreadEngagement({
  topicId,
  maxPostNumber,
  children,
}: {
  topicId: string;
  maxPostNumber: number;
  children: React.ReactNode;
}) {
  const status = useAuthStore((s) => s.status);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const beaconSent = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    // One decorated fetch for the whole page's liked-state…
    void api<{ items: { id: string; liked_by_viewer?: boolean; is_deleted: boolean }[] }>(
      `/community/topics/${topicId}/posts?after=${Math.max(0, maxPostNumber - 50)}&limit=50`,
    )
      .then((page) =>
        setLiked(new Set(page.items.filter((p) => !p.is_deleted && p.liked_by_viewer).map((p) => p.id))),
      )
      .catch(() => undefined);
    // …and one read beacon for the furthest post on screen.
    if (!beaconSent.current) {
      beaconSent.current = true;
      void apiJson(`/community/topics/${topicId}/read`, "PUT", { post_number: maxPostNumber }).catch(
        () => undefined,
      );
    }
  }, [status, topicId, maxPostNumber]);

  const toggle = async (postId: string) => {
    if (status !== "authenticated") return null;
    const isLiked = liked.has(postId);
    try {
      const out = await apiJson<{ like_count: number; liked: boolean }>(
        `/community/posts/${postId}/like`,
        isLiked ? "DELETE" : "PUT",
      );
      setLiked((prev) => {
        const next = new Set(prev);
        if (out.liked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      return out;
    } catch {
      return null;
    }
  };

  return <ThreadContext.Provider value={{ liked, toggle }}>{children}</ThreadContext.Provider>;
}

export function LikeButton({ postId, initialCount }: { postId: string; initialCount: number }) {
  const status = useAuthStore((s) => s.status);
  const thread = useContext(ThreadContext);
  const [count, setCount] = useState(initialCount);
  if (status !== "authenticated" || !thread) {
    return initialCount > 0 ? <span className="text-[0.78rem] opacity-60">♥ {initialCount}</span> : null;
  }
  const isLiked = thread.liked.has(postId);
  return (
    <button
      type="button"
      aria-label={isLiked ? "Unlike" : "Like"}
      aria-pressed={isLiked}
      className={`text-[0.78rem] ${isLiked ? "text-red-400" : "opacity-60 hover:opacity-100"}`}
      onClick={async () => {
        const out = await thread.toggle(postId);
        if (out) setCount(out.like_count);
      }}
    >
      ♥ {count}
    </button>
  );
}

// ── Lists: unread chips ──────────────────────────────────────────────────────

const UnreadContext = createContext<Map<string, boolean> | null>(null);

export function ListEngagement({
  query,
  children,
}: {
  /** The same query string the server used, so the decorated fetch matches. */
  query: string;
  children: React.ReactNode;
}) {
  const status = useAuthStore((s) => s.status);
  const [unread, setUnread] = useState<Map<string, boolean> | null>(null);
  useEffect(() => {
    if (status !== "authenticated") return;
    void api<{ items: { id: string; unread?: boolean }[] }>(`/community/topics?${query}`)
      .then((data) => setUnread(new Map(data.items.map((t) => [t.id, Boolean(t.unread)]))))
      .catch(() => undefined);
  }, [status, query]);
  return <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>;
}

export function UnreadBadge({ topicId }: { topicId: string }) {
  const unread = useContext(UnreadContext);
  if (!unread?.get(topicId)) return null;
  return (
    <span
      className="ml-2 inline-block size-2 rounded-full bg-[var(--mk-accent,#7c6cf6)] align-middle"
      title="New since you last read"
      data-testid="unread-badge"
    />
  );
}
