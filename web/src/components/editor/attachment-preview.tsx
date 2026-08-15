"use client";

/**
 * Attachment hover card — the file counterpart to PagePreview.
 *
 * Hovering an ![[image.png]] / [[report.pdf]] embed shows the file itself at a
 * useful size: images inline, PDFs in a scrollable embedded viewer, everything
 * else as a labelled card. Unlike PagePreview this card accepts pointer events
 * (`pointer-events: auto`) so a PDF can actually be scrolled.
 */

import { useQuery } from "@tanstack/react-query";

import { resolveAttachmentUrl } from "@/lib/editor/attachment-urls";

/** Extensions we render, and how. Anything else gets the generic card. */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const PDF_EXTS = new Set(["pdf"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov"]);

/** Everything the allowlist accepts — used to tell a file target from a note. */
const ATTACHMENT_EXTS = new Set([
  ...IMAGE_EXTS, ...PDF_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS,
  "txt", "md", "csv", "json", "docx", "xlsx", "pptx", "zip",
]);

export function attachmentExt(target: string): string | null {
  const name = target.split("/").pop() ?? target;
  if (!name.includes(".")) return null;
  const ext = name.split(".").pop()!.toLowerCase();
  return ATTACHMENT_EXTS.has(ext) ? ext : null;
}

/** True when a hovered wikilink points at a file rather than a note. */
export function isAttachmentTarget(target: string): boolean {
  // ".md" is a note, not an attachment, even though uploads accept it.
  const ext = attachmentExt(target);
  return ext !== null && ext !== "md";
}

const WIDTH = 420;
const MAX_HEIGHT = 460;

export function AttachmentPreview({
  vaultId,
  target,
  x,
  y,
  onEnter,
  onLeave,
}: {
  vaultId: string;
  target: string;
  x: number;
  y: number;
  /** Cancel the pending close so the card survives the pointer moving into it. */
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const filename = target.split("/").pop() ?? target;
  const ext = attachmentExt(target) ?? "";

  // react-query owns the async state (no setState-in-effect); resolveAttachmentUrl
  // already dedupes in-flight requests and caches until the presign expires.
  const { data: url, isError: failed } = useQuery({
    queryKey: ["attachment-url", vaultId, filename],
    queryFn: async () => {
      const resolved = await resolveAttachmentUrl(vaultId, filename);
      if (!resolved) throw new Error("not found");
      return resolved;
    },
    staleTime: 60_000,
    retry: false,
  });

  if (typeof window === "undefined") return null;
  const left = Math.min(x + 14, window.innerWidth - WIDTH - 12);
  const top =
    y + 18 + MAX_HEIGHT > window.innerHeight
      ? Math.max(8, y - MAX_HEIGHT - 12)
      : y + 18;

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="fixed z-50 overflow-hidden rounded-lg border border-ob-border bg-[var(--ob-color-base-25)] shadow-2xl"
      style={{ left, top, width: WIDTH, maxHeight: MAX_HEIGHT }}
    >
      <p className="truncate border-b border-ob-border px-3 py-1.5 text-[12px] font-medium text-ob-text">
        {filename}
      </p>
      <div className="flex max-h-[420px] items-center justify-center p-2">
        {failed ? (
          <p className="p-4 text-[13px] text-ob-faint">Attachment not found.</p>
        ) : !url ? (
          <p className="p-4 text-[13px] text-ob-faint">Loading…</p>
        ) : IMAGE_EXTS.has(ext) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={filename}
            className="max-h-[400px] max-w-full rounded object-contain"
          />
        ) : PDF_EXTS.has(ext) ? (
          // A plain <iframe> keeps the browser's own PDF viewer, so the card is
          // scrollable and paginated without shipping a PDF renderer.
          <iframe src={url} title={filename} className="h-[400px] w-full rounded border-0" />
        ) : AUDIO_EXTS.has(ext) ? (
          <audio src={url} controls className="w-full" />
        ) : VIDEO_EXTS.has(ext) ? (
          <video src={url} controls className="max-h-[400px] w-full rounded" />
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-4 text-[13px] text-ob-accent hover:underline"
          >
            Open {filename}
          </a>
        )}
      </div>
    </div>
  );
}
