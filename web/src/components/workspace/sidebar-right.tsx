"use client";

/** Right sidebar — Backlinks / Outgoing / Tags / Outline panes (Obsidian style). */

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, GitFork, Hash, Link2, List, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import { AiChatPane } from "./ai-chat-pane";
import { PagePreview, usePagePreview } from "@/components/editor/page-preview";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { linkApi, noteApi, searchApi } from "@/lib/api/endpoints";
import { useWorkspaceStore, type RightPaneKind } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

type PaneKind = RightPaneKind;

// Code-split — cosmos.gl must never enter the shared bundle
const GraphView = dynamic(
  () => import("@/components/graph/graph-view").then((m) => m.GraphView),
  { ssr: false, loading: () => <EmptyHint>Loading graph…</EmptyHint> },
);

export function SidebarRight({
  vaultId,
  noteId,
  onOpenNote,
  drawer = false,
}: {
  vaultId: string;
  noteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
  drawer?: boolean;
}) {
  const open = useWorkspaceStore((s) => s.rightSidebarOpen);
  const width = useWorkspaceStore((s) => s.rightWidth);
  const setWidth = useWorkspaceStore((s) => s.setRightWidth);
  const pane = useWorkspaceStore((s) => s.rightPane);
  const setPane = useWorkspaceStore((s) => s.setRightPane);
  const dragging = useRef(false);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: PointerEvent) => {
        if (dragging.current) setWidth(startWidth - (ev.clientX - startX));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, setWidth],
  );

  if (!drawer && !open) return null;

  const panes: { kind: PaneKind; label: string; icon: React.ReactNode }[] = [
    { kind: "backlinks", label: "Backlinks", icon: <Link2 className="size-4" strokeWidth={1.75} /> },
    { kind: "outgoing", label: "Outgoing links", icon: <ArrowRight className="size-4" strokeWidth={1.75} /> },
    { kind: "tags", label: "Tags", icon: <Hash className="size-4" strokeWidth={1.75} /> },
    { kind: "outline", label: "Outline", icon: <List className="size-4" strokeWidth={1.75} /> },
    { kind: "local-graph", label: "Local graph", icon: <GitFork className="size-4 rotate-90" strokeWidth={1.75} /> },
    { kind: "ai", label: "AI chat", icon: <Sparkles className="size-4" strokeWidth={1.75} /> },
  ];

  return (
    <div
      data-tour="panels"
      className="relative flex shrink-0 flex-col border-l border-ob-border bg-ob-sidebar"
      style={drawer ? { width: "100%", height: "100%" } : { width }}
    >
      <div className="flex items-center gap-0.5 border-b border-ob-border px-2 py-1">
        {panes.map((p) => (
          <Tooltip key={p.kind} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={p.label}
                aria-pressed={pane === p.kind}
                data-tour={p.kind === "ai" ? "ai" : undefined}
                onClick={() => setPane(p.kind)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors duration-150",
                  pane === p.kind
                    ? "bg-ob-active text-ob-text"
                    : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
                )}
              >
                {p.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{p.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div
        className={
          pane === "local-graph"
            ? "min-h-0 flex-1"
            : pane === "ai"
              ? "flex min-h-0 flex-1 flex-col p-2"
              : "min-h-0 flex-1 overflow-y-auto p-2"
        }
      >
        {pane === "backlinks" && <BacklinksPane vaultId={vaultId} noteId={noteId} onOpenNote={onOpenNote} />}
        {pane === "outgoing" && <OutgoingPane vaultId={vaultId} noteId={noteId} onOpenNote={onOpenNote} />}
        {pane === "tags" && <TagsPane vaultId={vaultId} />}
        {pane === "outline" && <OutlinePane vaultId={vaultId} noteId={noteId} />}
        {pane === "local-graph" && <LocalGraphPane vaultId={vaultId} noteId={noteId} onOpenNote={onOpenNote} />}
        {pane === "ai" && (
          <AiChatPane key={vaultId} vaultId={vaultId} noteId={noteId} onOpenNote={onOpenNote} />
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right sidebar"
        onPointerDown={onDragStart}
        className="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize hover:bg-ob-accent/40"
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-ob-faint uppercase">{children}</p>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-[12px] text-ob-faint">{children}</p>;
}

function BacklinksPane({
  vaultId,
  noteId,
  onOpenNote,
}: {
  vaultId: string;
  noteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["backlinks", vaultId, noteId],
    queryFn: () => linkApi.backlinks(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });
  const { data: mentions } = useQuery({
    queryKey: ["unlinked", vaultId, noteId],
    queryFn: () => linkApi.unlinkedMentions(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });
  const preview = usePagePreview();

  if (!noteId) return <EmptyHint>Open a note to see its backlinks.</EmptyHint>;

  return (
    <div className="space-y-4" {...preview.handlers}>
      {preview.anchor && <PagePreview vaultId={vaultId} anchor={preview.anchor} />}
      <div>
        <SectionLabel>Linked mentions {data ? `(${data.backlinks.length})` : ""}</SectionLabel>
        {data && data.backlinks.length === 0 && <EmptyHint>No backlinks yet.</EmptyHint>}
        {data?.backlinks.map((b) => (
          <button
            key={b.note_id}
            type="button"
            data-wikilink-target={b.title}
            onClick={() => onOpenNote(b.note_id, b.title)}
            className="block w-full rounded px-1.5 py-1 text-left hover:bg-ob-hover"
          >
            <span className="block truncate text-[13px] text-ob-accent">{b.title}</span>
            {b.snippets[0] && (
              <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ob-muted">
                {b.snippets[0]}
              </span>
            )}
          </button>
        ))}
      </div>
      <RelatedSection vaultId={vaultId} noteId={noteId} onOpenNote={onOpenNote} />
      <div>
        <SectionLabel>Unlinked mentions {mentions ? `(${mentions.unlinked_mentions.length})` : ""}</SectionLabel>
        {mentions && mentions.unlinked_mentions.length === 0 && <EmptyHint>None found.</EmptyHint>}
        {mentions?.unlinked_mentions.map((m) => (
          <button
            key={m.note_id}
            type="button"
            onClick={() => onOpenNote(m.note_id, m.title)}
            className="block w-full rounded px-1.5 py-1 text-left hover:bg-ob-hover"
          >
            <span className="block truncate text-[13px] text-ob-text">{m.title}</span>
            {m.snippets[0] && (
              <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ob-muted">
                {m.snippets[0]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function OutgoingPane({
  vaultId,
  noteId,
  onOpenNote,
}: {
  vaultId: string;
  noteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["outgoing", vaultId, noteId],
    queryFn: () => linkApi.outgoing(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });

  if (!noteId) return <EmptyHint>Open a note to see its outgoing links.</EmptyHint>;

  return (
    <div>
      <SectionLabel>Outgoing links {data ? `(${data.outgoing.length})` : ""}</SectionLabel>
      {data && data.outgoing.length === 0 && <EmptyHint>This note has no links yet.</EmptyHint>}
      {data?.outgoing.map((l) => (
        <button
          key={`${l.target_title}-${String(l.is_embed)}`}
          type="button"
          disabled={!l.target_note_id}
          onClick={() =>
            l.target_note_id && onOpenNote(l.target_note_id, l.resolved_title ?? l.target_title)
          }
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] hover:bg-ob-hover disabled:hover:bg-transparent"
        >
          <span className={cn("truncate", l.target_note_id ? "text-ob-accent" : "text-ob-accent/55 italic")}>
            {l.resolved_title ?? l.target_title}
          </span>
          {!l.target_note_id && <span className="text-[11px] text-ob-faint">(unresolved)</span>}
        </button>
      ))}
    </div>
  );
}

interface TagTreeNode {
  segment: string;
  full: string;
  count: number;
  children: TagTreeNode[];
}

/** Fold flat "a/b/c" tag names into a tree; parent counts sum descendants. */
function buildTagTree(tags: { name: string; count: number }[]): TagTreeNode[] {
  const roots: TagTreeNode[] = [];
  const find = (list: TagTreeNode[], segment: string, full: string): TagTreeNode => {
    let node = list.find((n) => n.segment === segment);
    if (!node) {
      node = { segment, full, count: 0, children: [] };
      list.push(node);
    }
    return node;
  };
  for (const t of tags) {
    const segments = t.name.split("/");
    let list = roots;
    let full = "";
    for (const seg of segments) {
      full = full ? `${full}/${seg}` : seg;
      const node = find(list, seg, full);
      node.count += t.count; // ancestors aggregate descendant usage
      list = node.children;
    }
  }
  const sortRec = (list: TagTreeNode[]) => {
    list.sort((a, b) => a.segment.localeCompare(b.segment));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function TagsPane({ vaultId }: { vaultId: string }) {
  const { data } = useQuery({ queryKey: ["tags", vaultId], queryFn: () => searchApi.tags(vaultId) });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const setLeftPane = useWorkspaceStore((s) => s.setLeftPane);
  const setSearchSeed = useWorkspaceStore((s) => s.setSearchSeed);

  const tree = useMemo(() => buildTagTree(data ?? []), [data]);

  const toggle = (full: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(full)) next.delete(full);
      else next.add(full);
      return next;
    });
  };
  const search = (full: string) => {
    setSearchSeed(`tag:${full}`);
    setLeftPane("search");
  };

  const renderBranch = (nodes: TagTreeNode[], depth: number) =>
    nodes.map((node) => (
      <div key={node.full}>
        <div
          className="flex items-center gap-0.5 rounded py-0.5 pr-1 hover:bg-ob-hover"
          style={{ paddingLeft: 2 + depth * 14 }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              aria-label={collapsed.has(node.full) ? `Expand ${node.full}` : `Collapse ${node.full}`}
              onClick={() => toggle(node.full)}
              className="flex size-4 shrink-0 items-center justify-center text-ob-faint hover:text-ob-text"
            >
              <ChevronRight
                className={collapsed.has(node.full) ? "size-3" : "size-3 rotate-90"}
                strokeWidth={2}
              />
            </button>
          ) : (
            <span className="size-4 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => search(node.full)}
            title={`Search tag:${node.full}`}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          >
            <span className="truncate text-[13px] text-ob-accent">#{node.segment}</span>
            <span className="shrink-0 text-[11px] text-ob-faint">{node.count}</span>
          </button>
        </div>
        {node.children.length > 0 && !collapsed.has(node.full) && renderBranch(node.children, depth + 1)}
      </div>
    ));

  return (
    <div>
      <SectionLabel>Tags {data ? `(${data.length})` : ""}</SectionLabel>
      {data && data.length === 0 && <EmptyHint>No tags in this vault yet.</EmptyHint>}
      <div className="pt-1">{renderBranch(tree, 0)}</div>
    </div>
  );
}

function OutlinePane({ vaultId, noteId }: { vaultId: string; noteId: string | null }) {
  const { data: note } = useQuery({
    queryKey: ["note", vaultId, noteId],
    queryFn: () => noteApi.get(vaultId, noteId as string),
    enabled: Boolean(noteId),
  });

  if (!noteId || !note) return <EmptyHint>Open a note to see its outline.</EmptyHint>;

  const headings = [...note.content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({
    level: m[1].length,
    text: m[2].replace(/[*_`[\]]/g, ""),
  }));

  if (headings.length === 0) return <EmptyHint>No headings in this note.</EmptyHint>;

  return (
    <div>
      <SectionLabel>Outline</SectionLabel>
      {headings.map((h, i) => (
        <p
          key={`${h.text}-${String(i)}`}
          className="truncate py-0.5 text-[13px] text-ob-muted"
          style={{ paddingLeft: 4 + (h.level - 1) * 12 }}
        >
          {h.text}
        </p>
      ))}
    </div>
  );
}


function LocalGraphPane({
  vaultId,
  noteId,
  onOpenNote,
}: {
  vaultId: string;
  noteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const [depth, setDepth] = useState(1);

  if (!noteId) return <div className="p-2"><EmptyHint>Open a note to see its local graph.</EmptyHint></div>;

  return (
    <div className="flex h-full flex-col">
      <label className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-ob-muted">
        Depth
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          className="flex-1 accent-[var(--ob-interactive-accent)]"
        />
        <span className="text-ob-faint">{depth}</span>
      </label>
      <div className="min-h-0 flex-1">
        <GraphView
          key={`${noteId}-${String(depth)}`}
          vaultId={vaultId}
          centerNoteId={noteId}
          depth={depth}
          compact
          onOpenNote={onOpenNote}
          onCreateNote={() => undefined}
        />
      </div>
    </div>
  );
}


function RelatedSection({
  vaultId,
  noteId,
  onOpenNote,
}: {
  vaultId: string;
  noteId: string;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["related", vaultId, noteId],
    queryFn: () => linkApi.related(vaultId, noteId),
    staleTime: 60_000,
  });

  if (!data || data.related.length === 0) return null;

  return (
    <div>
      <SectionLabel>Related notes</SectionLabel>
      {data.related.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpenNote(r.id, r.title)}
          className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-ob-hover"
        >
          <span className="truncate text-[13px] text-ob-text">{r.title}</span>
          <span className="shrink-0 text-[10px] text-ob-faint">
            {Math.round(r.similarity * 100)}%
          </span>
        </button>
      ))}
    </div>
  );
}
