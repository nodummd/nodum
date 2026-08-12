"use client";

/** Reading-view embeds: attachment images and note transclusion. */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { noteApi, searchApi } from "@/lib/api/endpoints";
import { resolveAttachmentUrl } from "@/lib/editor/attachment-urls";
import { sliceFragment } from "@/lib/editor/block-slice";

export function AttachmentImage({
  vaultId,
  filename,
  width,
}: {
  vaultId: string;
  filename: string;
  width?: number | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void resolveAttachmentUrl(vaultId, filename).then((resolved) => {
      if (!alive) return;
      if (resolved) setUrl(resolved);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [vaultId, filename]);

  if (failed) {
    return <span className="nodum-embed-placeholder">![[{filename}]] — attachment not found</span>;
  }
  if (!url) return <span className="nodum-embed-placeholder">Loading {filename}…</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={filename}
      style={width ? { maxWidth: width } : undefined}
      className="nodum-embed-image"
    />
  );
}

interface NoteEmbedProps {
  vaultId: string;
  target: string;
  /** `^block-id` or heading text — embeds just that slice of the note. */
  fragment?: string | null;
  onNavigate: (target: string) => void;
  /** Transclusion nesting guard. */
  depth?: number;
  renderContent: (content: string, depth: number) => React.ReactNode;
}

export function NoteEmbed({
  vaultId,
  target,
  fragment = null,
  onNavigate,
  depth = 0,
  renderContent,
}: NoteEmbedProps) {
  const { data: note, isError } = useQuery({
    queryKey: ["embed", vaultId, target],
    queryFn: async () => {
      try {
        return await noteApi.getByPath(vaultId, target);
      } catch {
        const candidates = await searchApi.quickSwitch(vaultId, target, 3);
        const exact = candidates.find((c) => c.title.toLowerCase() === target.toLowerCase());
        if (!exact) throw new Error("not found");
        return noteApi.get(vaultId, exact.id);
      }
    },
    retry: false,
  });

  if (isError) {
    return (
      <span className="nodum-embed-placeholder">
        ![[{target}]] <em>(note not found)</em>
      </span>
    );
  }
  if (!note) return <span className="nodum-embed-placeholder">Loading ![[{target}]]…</span>;
  if (depth >= 2) {
    return (
      <button type="button" className="internal-link" onClick={() => onNavigate(target)}>
        {note.title}
      </button>
    );
  }

  const sliced = fragment ? sliceFragment(note.content, fragment) : null;
  if (fragment && sliced === null) {
    return (
      <span className="nodum-embed-placeholder">
        ![[{target}#{fragment}]] <em>(block not found)</em>
      </span>
    );
  }

  return (
    <div className="nodum-note-embed">
      <button
        type="button"
        className="nodum-note-embed-title"
        onClick={() => onNavigate(target)}
        title={`Open ${note.title}`}
      >
        {note.title}
        {fragment ? <span className="text-ob-faint"> #{fragment}</span> : null}
      </button>
      <div className="nodum-note-embed-body">
        {renderContent(sliced ?? note.content, depth + 1)}
      </div>
    </div>
  );
}
