"use client";

/**
 * Where imported or synced notes land.
 *
 * Three answers, in the order people reach for them: the default (a folder
 * named after the source, made automatically), an existing folder picked from
 * the vault's own tree, or a new folder typed by name. The tree shows folders
 * only — notes are noise when the question is "where".
 *
 * The value is a path prefix (`folder_root` on the connection): "" for the
 * vault root, "Projects/Work" for a nested destination. Folders that do not
 * exist yet are created on first use by the sync engine, so "new folder" is
 * just a typed path, not an API call.
 */

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CornerDownRight, Folder, FolderPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { vaultApi } from "@/lib/api/endpoints";
import type { TreeItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

function foldersOf(items: TreeItem[]): FolderNode[] {
  const out: FolderNode[] = [];
  for (const item of items) {
    if (item.type === "folder") {
      out.push({ name: item.name, path: item.path, children: foldersOf(item.children) });
    }
  }
  return out;
}

export function FolderPicker({
  vaultId,
  value,
  onChange,
  sourceFolder,
}: {
  vaultId: string;
  value: string;
  onChange: (folderRoot: string) => void;
  /** The folder the source makes for itself ("Gmail", "Calendar") — shown so
   *  the default option says what will actually happen. */
  sourceFolder: string;
}) {
  const [mode, setMode] = useState<"default" | "existing" | "new">(value ? "existing" : "default");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");

  const { data: tree } = useQuery({
    queryKey: ["tree", vaultId],
    queryFn: () => vaultApi.tree(vaultId),
    enabled: mode === "existing",
  });
  const folders = useMemo(() => foldersOf(tree?.items ?? []), [tree]);

  const pick = (nextMode: "default" | "existing" | "new", folderRoot: string) => {
    setMode(nextMode);
    onChange(folderRoot);
  };

  return (
    <fieldset>
      <legend className="text-[12px] font-medium text-ob-text">Where notes go</legend>

      <div className="mt-1.5 space-y-1">
        <label className="flex items-start gap-2 text-[12px] text-ob-muted">
          <input
            type="radio"
            name="import-destination"
            checked={mode === "default"}
            onChange={() => pick("default", "")}
            className="mt-0.5 accent-ob-accent"
          />
          <span>
            <span className="text-ob-text">
              A <code className="rounded bg-ob-active px-1">{sourceFolder}/</code> folder at the
              vault root
            </span>
            <span className="block text-[11px] text-ob-faint">Made automatically — the default.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-[12px] text-ob-muted">
          <input
            type="radio"
            name="import-destination"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
            className="mt-0.5 accent-ob-accent"
          />
          <span className="text-ob-text">Inside an existing folder</span>
        </label>

        {mode === "existing" && (
          <div
            className="ml-5 max-h-40 overflow-y-auto rounded-md border border-ob-border bg-ob-bg p-1"
            data-testid="folder-tree"
          >
            {folders.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-ob-faint">
                No folders yet — the vault root it is, or type a new folder below.
              </p>
            )}
            {folders.map((folder) => (
              <FolderRow
                key={folder.path}
                node={folder}
                depth={0}
                selected={value}
                expanded={expanded}
                onToggle={(path) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                onPick={(path) => pick("existing", path)}
              />
            ))}
          </div>
        )}

        <label className="flex items-start gap-2 text-[12px] text-ob-muted">
          <input
            type="radio"
            name="import-destination"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="mt-0.5 accent-ob-accent"
          />
          <span className="text-ob-text">A new folder</span>
        </label>

        {mode === "new" && (
          <div className="ml-5 flex items-center gap-2">
            <FolderPlus className="size-3.5 shrink-0 text-ob-faint" />
            <Input
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                onChange(event.target.value.trim());
              }}
              placeholder="e.g. Sources/Google"
              aria-label="New folder name"
              className="h-8 text-[12px]"
            />
          </div>
        )}
      </div>

      {mode !== "default" && value && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ob-faint">
          <CornerDownRight className="size-3" />
          Notes land in{" "}
          <code className="rounded bg-ob-active px-1">
            {value}/{sourceFolder}/
          </code>
        </p>
      )}
    </fieldset>
  );
}

function FolderRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onPick,
}: {
  node: FolderNode;
  depth: number;
  selected: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onPick: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = selected === node.path;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded px-1 py-0.5",
          isSelected ? "bg-ob-active text-ob-text" : "text-ob-muted hover:bg-ob-hover",
        )}
        style={{ paddingLeft: depth * 14 + 2 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => onToggle(node.path)}
            className="flex size-4 items-center justify-center text-ob-faint"
          >
            <ChevronRight className={cn("size-3 transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="size-4" />
        )}
        <button
          type="button"
          onClick={() => onPick(node.path)}
          aria-pressed={isSelected}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
        >
          <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {isOpen &&
        node.children.map((child) => (
          <FolderRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onToggle={onToggle}
            onPick={onPick}
          />
        ))}
    </div>
  );
}
