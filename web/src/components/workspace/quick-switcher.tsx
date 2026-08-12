"use client";

/** Quick switcher (⌘O) — fuzzy note jump; Enter on no match creates the note. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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

  const { data: results } = useQuery({
    queryKey: ["quick-switch", vaultId, debouncedQuery],
    queryFn: () => searchApi.quickSwitch(vaultId, debouncedQuery),
    enabled: open,
    gcTime: 10_000, // per-keystroke entries must not pile up for 5 minutes
  });

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
    }
    setOpen(next);
  };

  const createNote = useMutation({
    mutationFn: (title: string) => noteApi.create(vaultId, { title }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
      onOpenNote(note.id, note.title);
      handleOpenChange(false);
    },
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
            if (highlighted) selectValue(highlighted);
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
      </Command>
    </CommandDialog>
  );
}
