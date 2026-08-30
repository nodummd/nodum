"use client";

/**
 * What a connection actually syncs.
 *
 * The connect flow asks Google which calendars the account can see and stores
 * the answer, precisely so this could exist — and until now it did not, so
 * everyone synced `primary` and nothing else. A person with a work calendar
 * and a personal one had the list of both sitting in the database, unusable.
 *
 * Every value here is validated on the server, which refuses the request with
 * a message naming the field. So this does not re-implement those rules: it
 * shows what the server said. Duplicating validation in the client is how the
 * two drift until the form allows something the API rejects.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  connectionsApi,
  type ConnectionSettings,
  type ProviderConnection,
} from "@/lib/api/endpoints";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

export function ConnectionSettingsPanel({ connection }: { connection: ProviderConnection }) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const settings = connection.settings ?? {};
  const isCalendar = connection.provider === "google_calendar";

  // Refetched on open. The stored list is whatever Google said at connect
  // time, so a calendar made since then would otherwise be unselectable —
  // with disconnect-and-reconnect as the only way to see it.
  const { data: fetched } = useQuery({
    queryKey: ["sync-calendars", connection.id],
    queryFn: () => connectionsApi.calendars(connection.id),
    enabled: isCalendar,
    staleTime: 60_000,
  });
  const available = fetched?.calendars ?? settings.available_calendars ?? [];
  const [selected, setSelected] = useState<string[]>(settings.calendar?.calendar_ids ?? ["primary"]);
  const [folderRoot, setFolderRoot] = useState(settings.folder_root ?? "");
  const [threshold, setThreshold] = useState(String(settings.people_threshold ?? 3));
  const [storeBodies, setStoreBodies] = useState(Boolean(settings.gmail?.store_bodies));

  const save = useMutation({
    mutationFn: (patch: ConnectionSettings) => connectionsApi.update(connection.id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
      toast("Saved. The change applies from the next sync.", "info");
    },
    // The server's message names the field it refused and why, which is more
    // use than anything this component could invent.
    onError: (e) => toastError(e, "Could not save these settings."),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const patch: ConnectionSettings = {
      folder_root: folderRoot.trim(),
      // Sent as a number, not a string: "3" is refused, and being refused for
      // the type of a field the user never typed would be baffling.
      people_threshold: Number(threshold),
    };
    if (isCalendar) patch.calendar = { calendar_ids: selected.length ? selected : ["primary"] };
    else patch.gmail = { store_bodies: storeBodies };
    save.mutate(patch);
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 border-t border-ob-border pt-3">
      {isCalendar && available.length > 0 && (
        <fieldset>
          <legend className="text-[12px] font-medium text-ob-text">Calendars to sync</legend>
          <p className="mt-0.5 text-[11px] text-ob-faint">
            Each one keeps its own place in the sync, so a calendar that fails does not make the
            others start over.
          </p>
          <ul className="mt-1.5 space-y-1">
            {available.map((calendar) => (
              <li key={calendar.id}>
                <label className="flex items-center gap-2 text-[12px] text-ob-muted">
                  <input
                    type="checkbox"
                    checked={selected.includes(calendar.id)}
                    onChange={() => toggle(calendar.id)}
                    className="size-3.5 accent-ob-accent"
                  />
                  <span className="truncate">{calendar.summary || calendar.id}</span>
                  {calendar.primary && <span className="text-[11px] text-ob-faint">(primary)</span>}
                </label>
              </li>
            ))}
          </ul>
          {selected.length === 0 && (
            <p className="mt-1 text-[11px] text-ob-accent">
              Nothing selected — your primary calendar will be used.
            </p>
          )}
          {fetched?.stale && (
            <p className="mt-1 text-[11px] text-ob-faint">
              This list could not be refreshed just now, so it may be out of date.
            </p>
          )}
        </fieldset>
      )}

      <label className="block">
        <span className="text-[12px] font-medium text-ob-text">Folder</span>
        <p className="mt-0.5 mb-1 text-[11px] text-ob-faint">
          Where synced notes go. Empty puts them at the top of the vault.
        </p>
        <input
          type="text"
          value={folderRoot}
          onChange={(e) => setFolderRoot(e.target.value)}
          placeholder="Sources/Google"
          className="w-full rounded-md border border-ob-border bg-ob-bg px-2 py-1 text-[12px] text-ob-text"
        />
      </label>

      <label className="block">
        <span className="text-[12px] font-medium text-ob-text">Link a person after</span>
        <p className="mt-0.5 mb-1 text-[11px] text-ob-faint">
          How many times someone has to appear before they get their own note. Lower it and every
          one-off correspondent becomes a node in your graph.
        </p>
        <input
          type="number"
          min={1}
          max={1000}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-24 rounded-md border border-ob-border bg-ob-bg px-2 py-1 text-[12px] text-ob-text"
        />
      </label>

      {!isCalendar && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={storeBodies}
            onChange={(e) => setStoreBodies(e.target.checked)}
            className="mt-0.5 size-3.5 accent-ob-accent"
          />
          <span>
            <span className="text-[12px] font-medium text-ob-text">Store message bodies</span>
            <p className="text-[11px] text-ob-faint">
              Off by default: notes carry who wrote, when, and the subject, but not the text. Turn
              it on and the message bodies are stored in your vault.
            </p>
          </span>
        </label>
      )}

      <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
        {save.isPending && <Loader2 className="mr-1 size-3.5 animate-spin" strokeWidth={2} />}
        Save
      </Button>
    </form>
  );
}
