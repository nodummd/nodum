"use client";

/** The signed-in layer of a thread page: the reply box, and edit/delete on
 *  your own posts. Server-rendered content stays untouched — these islands
 *  sit beside it and `router.refresh()` after every mutation so the page
 *  re-renders from the source of truth. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MarkdownBox } from "@/components/community/markdown-box";
import { communityApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";

export function ReplyBox({ topicId, locked }: { topicId: string; locked: boolean }) {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (locked) return null;
  if (status !== "authenticated") {
    return (
      <p className="mk-card mt-8 px-4 py-4">
        <Link href="/login" className="underline">
          Log in
        </Link>{" "}
        to reply — reading needs no account, writing does.
      </p>
    );
  }
  return (
    <div className="mt-8 space-y-3">
      <h3 className="mk-eyebrow">Reply</h3>
      <MarkdownBox value={content} onChange={setContent} placeholder="Add to the conversation. Markdown works." minRows={4} />
      {error && <p className="text-[0.85rem] text-red-400">{error}</p>}
      <button
        type="button"
        disabled={busy || !content.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await communityApi.reply(topicId, content);
            setContent("");
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not post the reply.");
          } finally {
            setBusy(false);
          }
        }}
        className="mk-btn mk-btn--primary h-10 px-5 disabled:opacity-50"
      >
        {busy ? "Posting…" : "Post reply"}
      </button>
    </div>
  );
}

export function PostControls({
  postId,
  postNumber,
  authorId,
  topicId,
  content,
  locked,
}: {
  postId: string;
  postNumber: number;
  authorId: string | null;
  topicId: string;
  content: string;
  locked: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [busy, setBusy] = useState(false);

  if (!user || user.id !== authorId || locked) return null;

  if (editing) {
    return (
      <div className="mt-3 space-y-2">
        <MarkdownBox value={draft} onChange={setDraft} minRows={4} />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !draft.trim()}
            className="mk-btn mk-btn--primary h-8 px-3 text-[0.8rem] disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              try {
                await communityApi.editPost(postId, draft);
                setEditing(false);
                router.refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
          <button type="button" className="mk-navlink text-[0.8rem]" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className="mt-2 flex gap-3 text-[0.78rem] opacity-70">
      <button type="button" className="hover:underline" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button
        type="button"
        className="hover:underline"
        onClick={async () => {
          if (!window.confirm(postNumber === 1 ? "Delete this topic?" : "Delete this reply?")) return;
          if (postNumber === 1) {
            await communityApi.deleteTopic(topicId).catch(() => undefined);
            router.push("/community");
            router.refresh();
            return;
          }
          await communityApi.deletePost(postId).catch(() => undefined);
          router.refresh();
        }}
      >
        Delete
      </button>
    </p>
  );
}
