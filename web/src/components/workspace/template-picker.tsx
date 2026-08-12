"use client";

/** Template picker — lists notes in the Templates folder, inserts into the active note. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { dailyApi } from "@/lib/api/endpoints";
import { toastError } from "@/lib/stores/toast-store";

interface TemplatePickerProps {
  vaultId: string;
  noteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplatePicker({ vaultId, noteId, open, onOpenChange }: TemplatePickerProps) {
  const queryClient = useQueryClient();

  const { data: templates } = useQuery({
    queryKey: ["templates", vaultId],
    queryFn: () => dailyApi.listTemplates(vaultId),
    enabled: open,
  });

  const insert = useMutation({
    mutationFn: (templateId: string) =>
      dailyApi.insertTemplate(vaultId, noteId as string, templateId),
    onSuccess: (note) => {
      queryClient.setQueryData(["note", vaultId, note.id], note);
      void queryClient.invalidateQueries({ queryKey: ["note", vaultId, note.id] });
      onOpenChange(false);
    },
    onError: (err) => toastError(err, "Could not insert template."),
  });

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Insert template"
      description="Pick a template note"
      className="border border-ob-border bg-[var(--ob-color-base-25)] shadow-2xl sm:max-w-[480px]"
    >
      <Command>
        <CommandInput placeholder="Pick a template…" />
        <CommandList>
          <CommandEmpty>
            {noteId
              ? "No templates. Create notes inside a “Templates” folder."
              : "Open a note first, then insert a template."}
          </CommandEmpty>
          {noteId && (
            <CommandGroup heading="Templates">
              {templates?.map((t) => (
                <CommandItem key={t.id} value={t.title} onSelect={() => insert.mutate(t.id)}>
                  {t.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
