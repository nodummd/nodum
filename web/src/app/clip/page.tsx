"use client";

/**
 * Web clipper — the PWA share-target lands here (GET params title/text/url),
 * and it doubles as a manual "paste something, save a note" page. Clips are
 * saved into a "Clippings" folder in the user's first vault.
 */

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { folderApi, noteApi, vaultApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function ClipForm() {
  const params = useSearchParams();
  const status = useAuthStore((s) => s.status);

  const sharedTitle = params.get("title") ?? "";
  const sharedText = params.get("text") ?? "";
  const sharedUrl = params.get("url") ?? "";

  const [title, setTitle] = useState(sharedTitle || `Clip ${todayStamp()}`);
  const [content, setContent] = useState(
    [sharedText, sharedUrl ? `\n\nSource: ${sharedUrl}` : ""].join("").trim(),
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const save = async () => {
    setState("saving");
    try {
      const vaults = await vaultApi.list();
      const vault = vaults[0];
      if (!vault) throw new Error("No vault found.");

      const tree = await vaultApi.tree(vault.id);
      let folderId = (
        tree.items.find(
          (item) => item.type === "folder" && item.name === "Clippings",
        ) as { id: string } | undefined
      )?.id;
      folderId ??= (await folderApi.create(vault.id, { name: "Clippings" })).id;

      let note;
      try {
        note = await noteApi.create(vault.id, { title, folder_id: folderId, content });
      } catch {
        // duplicate title → make it unique
        note = await noteApi.create(vault.id, {
          title: `${title} ${new Date().toISOString().slice(11, 19)}`,
          folder_id: folderId,
          content,
        });
      }
      setVaultId(vault.id);
      setMessage(note.title);
      setState("saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save the clip.");
      setState("error");
    }
  };

  if (status === "loading") {
    return <p className="text-[13px] text-ob-faint">Loading…</p>;
  }
  if (status === "anonymous") {
    return (
      <p className="text-[14px] text-ob-muted">
        You need to be logged in to clip.{" "}
        <Link href="/login" className="text-ob-accent hover:underline">
          Log in
        </Link>{" "}
        and share again.
      </p>
    );
  }

  if (state === "saved") {
    return (
      <div className="space-y-3">
        <p className="text-[15px] text-ob-text">
          Saved <span className="font-semibold">“{message}”</span> to Clippings ✓
        </p>
        {vaultId && (
          <Link
            href={`/vault/${vaultId}`}
            className="inline-block rounded-md bg-[var(--ob-interactive-accent)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
          >
            Open vault
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[12px] text-ob-muted">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Clip title"
          className="w-full rounded-md border border-ob-border bg-ob-bg px-3 py-2 text-[14px] text-ob-text outline-none focus:border-ob-accent"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] text-ob-muted">Content</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Clip content"
          rows={8}
          placeholder="Paste text or a URL…"
          className="w-full rounded-md border border-ob-border bg-ob-bg px-3 py-2 text-[14px] text-ob-text outline-none focus:border-ob-accent"
        />
      </label>
      {state === "error" && <p className="text-[13px] text-[#ff8a95]">{message}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={state === "saving" || !title.trim()}
        className="rounded-md bg-[var(--ob-interactive-accent)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {state === "saving" ? "Saving…" : "Save to vault"}
      </button>
    </div>
  );
}

export default function ClipPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-1 text-[20px] font-bold text-ob-text">Clip to Nodum</h1>
      <p className="mb-6 text-[13px] text-ob-faint">
        Shared pages and text become notes in your Clippings folder.
      </p>
      <Suspense fallback={<p className="text-[13px] text-ob-faint">Loading…</p>}>
        <ClipForm />
      </Suspense>
    </main>
  );
}
