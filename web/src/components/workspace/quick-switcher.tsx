"use client";

/** Quick switcher (⌘O) — fuzzy note jump; Enter on no match creates the note. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { noteApi, searchApi } from "@/lib/api/endpoints";
import { resolveNewNoteFolder } from "@/lib/new-note-location";
import { toastError } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function QuickSwitcher({
  vaultId,
  onOpenNote,
}: {
  vaultId: string;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const open = useWorkspaceStore((s) => s.switcherOpen);
  const setOpen = useWorkspaceStore((s) => s.setSwitcherOpen);
  const openTabBackground = useWorkspaceStore((s) => s.openTabBackground);
  const [query, setQuery] = useState("");
  // Server queries fire on the debounced copy — not per keystroke
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);
  // User's manual arrow-key choice; effective highlight is derived below so
  // async result arrival never needs an effect.
  const [chosen, setChosen] = useState("");
  const queryClient = useQueryClient();

  const {
    data: results,
    isFetching,
    isError,
  } = useQuery({
    queryKey: ["quick-switch", vaultId, debouncedQuery],
    queryFn: () => searchApi.quickSwitch(vaultId, debouncedQuery),
    enabled: open,
    gcTime: 10_000, // per-keystroke entries must not pile up for 5 minutes
  });
  // Results lag the typing by the debounce plus a round trip. Enter pressed
  // in that window used to act on the PREVIOUS query's list (type fast, hit
  // Enter, land in the wrong note); now it waits for the list that matches
  // what was typed, then acts once.
  // (A failed request is not "still loading": Enter then falls through to
  // Create, as it did before.)
  const stale = query.trim() !== debouncedQuery.trim() || isFetching || (results === undefined && !isError);
  const pendingEnter = useRef<null | { background: boolean }>(null);

  const trimmed = query.trim();
  const exactMatch =
    results?.some(
      (r) =>
        r.title.toLowerCase() === trimmed.toLowerCase() ||
        r.alias?.toLowerCase() === trimmed.toLowerCase(),
    ) ?? false;
  const createValue = trimmed && !exactMatch ? `__create-${trimmed}` : "";

  const validValues = new Set([...(results?.map((r) => r.id) ?? []), createValue].filter(Boolean));
  const highlighted = validValues.has(chosen)
    ? chosen
    : (results?.[0]?.id ?? (createValue || ""));

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setChosen("");
      pendingEnter.current = null;
    }
    setOpen(next);
  };

  const createNote = useMutation({
    mutationFn: (title: string) =>
      noteApi.create(vaultId, {
        title,
        folder_path: resolveNewNoteFolder(queryClient, vaultId),
      }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
      onOpenNote(note.id, note.title);
      handleOpenChange(false);
    },
    onError: (err) => toastError(err, "Could not create the note."),
  });

  const selectValue = (value: string) => {
    const match = results?.find((r) => r.id === value);
    if (match) {
      onOpenNote(match.id, match.title);
      handleOpenChange(false);
    } else if (value.startsWith("__create-") && trimmed) {
      createNote.mutate(trimmed);
    }
  };

  const act = (background: boolean) => {
    if (background) {
      const match = results?.find((r) => r.id === highlighted);
      if (match) {
        openTabBackground({ id: match.id, kind: "note", title: match.title });
        handleOpenChange(false);
      }
      return;
    }
    if (highlighted) selectValue(highlighted);
  };

  useEffect(() => {
    const pending = pendingEnter.current;
    if (!pending || stale) return;
    pendingEnter.current = null;
    act(pending.background);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, highlighted]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Quick switcher"
      description="Jump to a note by name"
      className="border border-ob-border bg-[var(--ob-color-base-25)] shadow-2xl sm:max-w-[540px]"
    >
      <Command shouldFilter={false} value={highlighted} onValueChange={setChosen}>
        <CommandInput
          placeholder="Find or create a note…"
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            // Shift+Enter force-creates with the typed name, match or not
            if (e.shiftKey) {
              if (trimmed) createNote.mutate(trimmed);
              return;
            }
            // ⌘/Ctrl+Enter opens the match in the background (no tab switch).
            // While the list is still catching up with the typing, remember
            // the intent and act when it has.
            const background = e.metaKey || e.ctrlKey;
            if (stale) {
              pendingEnter.current = { background };
              return;
            }
            act(background);
          }}
        />
        <CommandList>
          <CommandEmpty>{trimmed ? "No matching notes." : "Type to search notes."}</CommandEmpty>
          <CommandGroup heading={trimmed ? "Notes" : "Recent"}>
            {results?.map((r) => (
              <CommandItem key={r.id} value={r.id} onSelect={selectValue}>
                {r.alias ? (
                  <>
                    <span className="truncate">{r.alias}</span>
                    <span className="ml-auto truncate pl-4 text-[11px] text-ob-faint">
                      ↳ alias of {r.title}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{r.title}</span>
                    {r.path !== r.title && (
                      <span className="ml-auto truncate pl-4 text-[11px] text-ob-faint">{r.path}</span>
                    )}
                  </>
                )}
              </CommandItem>
            ))}
            {createValue && (
              <CommandItem value={createValue} onSelect={() => createNote.mutate(trimmed)}>
                <span className="text-ob-accent">Create “{trimmed}”</span>
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
        <div className="flex items-center gap-3 border-t border-ob-border px-3 py-1.5 text-[11px] text-ob-faint">
          <span>
            <kbd className="rounded border border-ob-border px-1">↵</kbd> open
          </span>
          <span>
            <kbd className="rounded border border-ob-border px-1">⇧↵</kbd> create
          </span>
          <span>
            <kbd className="rounded border border-ob-border px-1">⌘↵</kbd> open in background
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
