/**
 * Paste / drag-drop file upload for the markdown editor.
 *
 * Files go to the attachment API and an Obsidian-style embed (`![[name]]`, or
 * `[[name]]` for things that don't render inline) is written at the cursor. A
 * placeholder holds the spot while the upload is in flight so the caret never
 * jumps and a slow upload can't silently swallow the drop.
 */

import type { EditorView } from "@codemirror/view";
import { EditorView as CMView } from "@codemirror/view";

import { attachmentApi } from "@/lib/api/endpoints";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

/** Mirrors the server allowlist so obvious rejects never leave the browser. */
const ACCEPTED = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico",
  "pdf", "txt", "md", "csv", "json", "docx", "xlsx", "pptx",
  "mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov", "zip",
]);
/** Kept in sync with MAX_ATTACHMENT_SIZE_BYTES. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Only these render as an inline embed; the rest become plain links. */
const EMBEDDABLE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "pdf"]);

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

/** Insert text, returning a CodeMirror position that tracks later edits.
 *  Absolute offsets go stale the moment anything else changes the document —
 *  a second upload finishing first, or the user typing — so the placeholder is
 *  addressed through the document's own change mapping instead. */
function insertTracked(view: EditorView, at: number, text: string) {
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
  });
  return { from: at, to: at + text.length, doc: view.state.doc };
}

/** Upload one file and swap its placeholder for the finished embed. */
async function uploadOne(view: EditorView, vaultId: string, file: File, at: number): Promise<number> {
  const ext = extOf(file.name);
  if (!ACCEPTED.has(ext)) {
    useToastStore.getState().push(`“${file.name}” is not an accepted file type.`, "error");
    return at;
  }
  if (file.size > MAX_BYTES) {
    useToastStore
      .getState()
      .push(
        `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`,
        "error",
      );
    return at;
  }

  const placeholder = `![[Uploading ${file.name}…]]`;
  insertTracked(view, at, placeholder);

  /** Find the placeholder wherever it has drifted to. Searching for the exact
   *  marker is robust to any concurrent edit and cannot clobber other text. */
  const locate = () => {
    const idx = view.state.doc.toString().indexOf(placeholder);
    return idx < 0 ? null : { from: idx, to: idx + placeholder.length };
  };

  try {
    const uploaded = await attachmentApi.upload(vaultId, file);
    const embed = EMBEDDABLE.has(ext) ? `![[${uploaded.filename}]]` : `[[${uploaded.filename}]]`;
    const range = locate();
    if (!range) return at; // user deleted the placeholder mid-upload — respect that
    view.dispatch({
      changes: { ...range, insert: embed },
      selection: { anchor: range.from + embed.length },
    });
    return range.from + embed.length;
  } catch (err) {
    const range = locate();
    // Take the placeholder back out so a failure leaves the document as it was.
    if (range) view.dispatch({ changes: { ...range, insert: "" } });
    toastError(err, `Could not upload “${file.name}”.`);
    return at;
  }
}

/** Upload sequentially so each embed lands after the previous one. */
async function uploadAll(view: EditorView, vaultId: string, files: File[], start: number) {
  let at = start;
  for (const file of files) {
    at = await uploadOne(view, vaultId, file, at);
  }
}

/** CodeMirror extension: paste and drop files to upload them. */
export function attachmentUpload(vaultId: string) {
  return CMView.domEventHandlers({
    paste(event, view) {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return false; // plain text — let CodeMirror handle it
      event.preventDefault();
      void uploadAll(view, vaultId, files, view.state.selection.main.from);
      return true;
    },
    drop(event, view) {
      // A note dragged from the explorer links rather than uploads.
      const noteJson = event.dataTransfer?.getData("application/x-nodum-note");
      if (noteJson) {
        event.preventDefault();
        try {
          const note = JSON.parse(noteJson) as { title: string };
          const at =
            view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
            view.state.selection.main.from;
          const link = `[[${note.title}]]`;
          view.dispatch({
            changes: { from: at, insert: link },
            selection: { anchor: at + link.length },
          });
          view.focus();
        } catch {
          /* malformed payload — nothing sensible to insert */
        }
        return true;
      }

      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return false;
      event.preventDefault();
      // Drop at the cursor under the pointer, not wherever the caret was.
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
      void uploadAll(view, vaultId, files, at);
      return true;
    },
    dragover(event) {
      // Without this the browser navigates away to the dropped file, and a
      // dragged note would never produce a drop event at all.
      const types = event.dataTransfer?.types ?? [];
      if (types.includes("Files") || types.includes("application/x-nodum-note")) {
        event.preventDefault();
      }
      return false;
    },
  });
}
