"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Loader2, Search, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { BrandIcon } from "./brand-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { importApi, type ImportResult, type ImportSource } from "@/lib/api/endpoints";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

/**
 * The import picker.
 *
 * Two steps rather than one, deliberately. A grid of twenty sources with a
 * file input under each would be shorter to build and much worse to use: what
 * people are actually missing is *how to get the export out of the other app*,
 * and that guidance only fits once a source has been chosen. So: pick a
 * source, read its three steps, then drop the file.
 *
 * The caveats are shown on the same screen as the upload, before anything is
 * committed. Telling someone that Slack exports omit file contents is useful
 * beforehand and merely annoying afterwards.
 */
export function ImportDialog({
  vaultId,
  open,
  onOpenChange,
}: {
  vaultId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ImportSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const { data, isPending } = useQuery({
    queryKey: ["import-sources"],
    queryFn: () => importApi.sources(),
    // A static catalogue per deployment — refetching it on every open is waste.
    staleTime: 60 * 60 * 1000,
    enabled: open,
  });

  const grouped = useMemo(() => {
    const sources = data?.sources ?? [];
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? sources.filter(
          (s) =>
            s.name.toLowerCase().includes(needle) ||
            s.blurb.toLowerCase().includes(needle) ||
            s.id.includes(needle),
        )
      : sources;
    const byCategory = new Map<string, ImportSource[]>();
    for (const source of matched) {
      const list = byCategory.get(source.category_label) ?? [];
      list.push(source);
      byCategory.set(source.category_label, list);
    }
    return [...byCategory.entries()];
  }, [data, query]);

  const reset = useCallback(() => {
    setPicked(null);
    setResult(null);
    setQuery("");
    setBusy(false);
  }, []);

  const upload = useCallback(
    (files: File[]) => {
      if (!picked || files.length === 0) return;
      setBusy(true);
      setResult(null);
      void (async () => {
        try {
          const stats = await importApi.run(vaultId, picked.id, files);
          setResult(stats);
          // The tree, the graph and the tag pane are all stale now.
          for (const key of ["tree", "graph", "tags"]) {
            void queryClient.invalidateQueries({ queryKey: [key, vaultId] });
          }
          useToastStore
            .getState()
            .push(`Imported ${String(stats.imported)} notes from ${stats.source_name}`, "info");
        } catch (err) {
          toastError(err, "Import failed.");
        } finally {
          setBusy(false);
        }
      })();
    },
    [picked, vaultId, queryClient],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = [...event.dataTransfer.files];
      if (files.length) upload(files);
    },
    [upload],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-0 overflow-clip border-ob-border bg-ob-sidebar p-0 sm:max-w-[820px]">
        <DialogHeader className="border-b border-ob-border px-5 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            {picked && (
              <button
                type="button"
                onClick={reset}
                aria-label="Back to all sources"
                className="-ml-1 rounded p-1 text-ob-muted hover:bg-ob-hover hover:text-ob-text"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            {picked ? `Import from ${picked.name}` : "Import data"}
          </DialogTitle>
          <DialogDescription className={picked ? "text-[13px]" : "sr-only"}>
            {picked
              ? picked.blurb
              : "Bring your notes in from another app. Everything becomes plain markdown."}
          </DialogDescription>
        </DialogHeader>

        <div className="h-[min(560px,76vh)] overflow-y-auto">
          {!picked && (
            <PickerGrid
              grouped={grouped}
              total={data?.sources.length ?? 0}
              isPending={isPending}
              query={query}
              onQuery={setQuery}
              onPick={setPicked}
            />
          )}

          {picked && !result && (
            <SourceDetail
              source={picked}
              busy={busy}
              dragging={dragging}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onPickFiles={() => fileRef.current?.click()}
              onPickFolder={() => folderRef.current?.click()}
            />
          )}

          {picked && result && <ImportSummary result={result} onAgain={reset} />}
        </div>

        {/* One pair of inputs for the whole dialog; `accept` follows the source. */}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept={picked?.accepts.join(",")}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            upload(files);
          }}
        />
        <input
          ref={folderRef}
          type="file"
          hidden
          // Non-standard but universally supported, and the only way to let
          // someone hand over an Obsidian vault without zipping it first.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            upload(files);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PickerGrid({
  grouped,
  total,
  isPending,
  query,
  onQuery,
  onPick,
}: {
  grouped: [string, ImportSource[]][];
  total: number;
  isPending: boolean;
  query: string;
  onQuery: (value: string) => void;
  onPick: (source: ImportSource) => void;
}) {
  return (
    <div className="p-5">
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ob-faint" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={total ? `Search ${String(total)} sources…` : "Search sources…"}
          aria-label="Search import sources"
          className="h-9 pl-8 text-[13px]"
          autoFocus
        />
      </div>

      {isPending && (
        <p className="py-16 text-center text-[13px] text-ob-faint">Loading sources…</p>
      )}

      {!isPending && grouped.length === 0 && (
        <p className="py-16 text-center text-[13px] text-ob-muted">
          Nothing matches “{query}”. Any folder of markdown works — try “Markdown files”.
        </p>
      )}

      {grouped.map(([label, sources]) => (
        <section key={label} className="mb-6 last:mb-0">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-ob-faint uppercase">
            {label}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => onPick(source)}
                  className="nodum-import-card"
                >
                  <BrandIcon icon={source.icon} accent={source.accent} name={source.name} />
                  <span className="min-w-0">
                    <span className="nodum-import-name">{source.name}</span>
                    <span className="nodum-import-blurb">{source.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SourceDetail({
  source,
  busy,
  dragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickFiles,
  onPickFolder,
}: {
  source: ImportSource;
  busy: boolean;
  dragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
}) {
  return (
    <div className="p-5">
      <ol className="mb-5 space-y-2.5">
        {source.steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-[13px] leading-relaxed text-ob-muted">
            <span className="nodum-import-step">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {source.caveats.length > 0 && (
        <div className="nodum-import-caveats">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-ob-accent" />
          <ul className="space-y-1">
            {source.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      {source.connect_note && (
        <p className="mt-3 text-[12px] leading-relaxed text-ob-faint">{source.connect_note}</p>
      )}

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn("nodum-import-drop", dragging && "is-dragging", busy && "is-busy")}
      >
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin text-ob-accent" />
            <p className="text-[13px] text-ob-text">Importing…</p>
            <p className="text-[12px] text-ob-faint">
              Large exports take a moment — links resolve across the whole batch at the end.
            </p>
          </>
        ) : (
          <>
            <Upload className="size-5 text-ob-faint" />
            <p className="text-[13px] text-ob-text">Drop your export here</p>
            <p className="text-[12px] text-ob-faint">Accepts {source.accepts.join(", ")}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={onPickFiles}>
                Choose file
              </Button>
              <Button size="sm" variant="secondary" onClick={onPickFolder}>
                Choose folder
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ImportSummary({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  const bits = [
    `${result.imported} notes`,
    result.imported_attachments ? `${result.imported_attachments} attachments` : null,
    result.imported_pdf_notes ? `${result.imported_pdf_notes} from PDFs` : null,
    result.renamed ? `${result.renamed} renamed to avoid collisions` : null,
  ].filter(Boolean);

  return (
    <div className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="nodum-import-done">
          <Check className="size-4" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-ob-text">
            Imported from {result.source_name}
          </p>
          <p className="text-[13px] text-ob-muted">{bits.join(" · ")}</p>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <div className="nodum-import-caveats">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-ob-accent" />
          <ul className="space-y-1">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {(result.skipped_too_large ?? 0) > 0 && (
        <p className="mt-3 text-[12px] text-ob-faint">
          {result.skipped_too_large} file(s) were too large and were skipped.
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onAgain}>
          Import something else
        </Button>
      </div>
    </div>
  );
}
