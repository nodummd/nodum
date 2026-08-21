"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MarkdownBox } from "@/components/forum/markdown-box";
import { communityApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";

export function NewTopicForm({
  categories,
}: {
  categories: { slug: string; name: string; staffOnly: boolean }[];
}) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [category, setCategory] = useState("help");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "anonymous") {
    return (
      <p className="mk-card px-4 py-6">
        <Link href="/login" className="underline">
          Log in
        </Link>{" "}
        to start a topic — reading needs no account, writing does.
      </p>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const topic = await communityApi.createTopic(category, title, content);
      router.push(`/forum/t/${topic.id}/${topic.slug}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the topic.");
      setBusy(false);
    }
  };

  return (
    <form
      className="mx-auto max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
    >
      <h2 className="mk-display text-[1.5rem]">New topic</h2>
      <label className="block text-[0.85rem]">
        <span className="mk-eyebrow mb-1 block">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mk-card w-full px-3 py-2"
          aria-label="Category"
        >
          {categories.map((c) => (
            <option key={c.slug} value={c.slug} disabled={c.staffOnly && !user?.is_staff}>
              {c.name}
              {c.staffOnly ? " (staff)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[0.85rem]">
        <span className="mk-eyebrow mb-1 block">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Say it in one clear line"
          className="mk-card w-full px-3 py-2"
          aria-label="Title"
        />
      </label>
      <MarkdownBox value={content} onChange={setContent} placeholder="What's on your mind? Markdown works." />
      {error && <p className="text-[0.85rem] text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || title.trim().length < 3 || !content.trim()}
        className="mk-btn mk-btn--primary h-10 px-5 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create topic"}
      </button>
    </form>
  );
}
