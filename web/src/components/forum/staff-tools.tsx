"use client";

/** Report (any member) and moderation (staff) islands for thread pages.
 *  Staff visibility keys off is_staff on /auth/me — the server enforces
 *  either way; hiding is courtesy, not security. */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { communityApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";

export function ReportButton({ postId, authorId }: { postId: string; authorId: string | null }) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "dup">("idle");

  if (!user || user.id === authorId) return null;
  if (state === "sent") return <span className="text-[0.78rem] opacity-60">Reported — staff will look.</span>;
  if (state === "dup") return <span className="text-[0.78rem] opacity-60">You already reported this.</span>;

  if (!open) {
    return (
      <button type="button" className="text-[0.78rem] opacity-60 hover:underline hover:opacity-100" onClick={() => setOpen(true)}>
        Report
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[0.8rem]">
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="mk-card px-2 py-1" aria-label="Reason">
        <option value="spam">Spam</option>
        <option value="abuse">Abuse</option>
        <option value="off-topic">Off topic</option>
        <option value="other">Other</option>
      </select>
      <input
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Anything staff should know (optional)"
        className="mk-card w-60 px-2 py-1"
        aria-label="Report detail"
      />
      <button
        type="button"
        className="mk-btn mk-btn--primary h-7 px-3 text-[0.78rem]"
        onClick={async () => {
          try {
            await communityApi.report(postId, reason, detail);
            setState("sent");
          } catch (e) {
            setState(e instanceof Error && e.message.includes("already") ? "dup" : "sent");
          }
        }}
      >
        Send
      </button>
      <button type="button" className="opacity-60 hover:underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export function StaffTopicControls({
  topicId,
  pinned,
  locked,
}: {
  topicId: string;
  pinned: boolean;
  locked: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  if (!user?.is_staff) return null;

  const act = async (patch: { pinned?: boolean; locked?: boolean }) => {
    await communityApi.moderateTopic(topicId, patch).catch(() => undefined);
    router.refresh();
  };
  return (
    <p className="mk-card mt-2 inline-flex items-center gap-3 px-3 py-1.5 text-[0.8rem]" data-testid="staff-controls">
      <span className="mk-eyebrow">Staff</span>
      <button type="button" className="hover:underline" onClick={() => act({ pinned: !pinned })}>
        {pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" className="hover:underline" onClick={() => act({ locked: !locked })}>
        {locked ? "Unlock" : "Lock"}
      </button>
      <button
        type="button"
        className="text-red-400 hover:underline"
        onClick={async () => {
          if (!window.confirm("Delete this whole topic?")) return;
          await communityApi.staffDeleteTopic(topicId).catch(() => undefined);
          router.push("/forum");
          router.refresh();
        }}
      >
        Delete topic
      </button>
    </p>
  );
}

export function StaffPostDelete({ postId, authorId }: { postId: string; authorId: string | null }) {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  if (!user?.is_staff || user.id === authorId) return null;
  return (
    <button
      type="button"
      className="text-[0.78rem] text-red-400 hover:underline"
      onClick={async () => {
        if (!window.confirm("Remove this post?")) return;
        await communityApi.staffDeletePost(postId).catch(() => undefined);
        router.refresh();
      }}
    >
      Remove (staff)
    </button>
  );
}
