"use client";

/**
 * Live sync, inside the Import dialog.
 *
 * Everything about a Google connection lives here: the setup screen where the
 * options are chosen *before* connecting (they ride the OAuth state, so the
 * first sync runs from them), the connected list with its honest statuses,
 * and the same screen again as an editor once a connection exists.
 *
 * Validation is the server's. Every value here is checked by
 * `connection_settings.clean`, which refuses with a message naming the field —
 * re-implementing those rules client-side is how the two drift until the form
 * allows what the API rejects.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Link2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { FolderPicker } from "./folder-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmDelete } from "@/components/workspace/confirm-dialog";
import {
  connectionsApi,
  type ConnectionSettings,
  type ProviderConnection,
  type SyncProvider,
} from "@/lib/api/endpoints";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

/** History windows offered as one-click chips. 0 is "future only". */
const WINDOWS: { label: string; days: number }[] = [
  { label: "Future only", days: 0 },
  { label: "24 hours", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

/** Gmail's fixed system labels, offered as chips; anything else is typed. */
const COMMON_LABELS = [
  "INBOX",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "CATEGORY_PERSONAL",
  "CATEGORY_UPDATES",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
];

function isGmail(provider: string): boolean {
  return provider === "google_gmail";
}

function sourceFolderFor(provider: string): string {
  return isGmail(provider) ? "Gmail" : "Calendar";
}

// ── the setup screen (create and edit are the same form) ────────────────────

export function SyncSetup({
  vaultId,
  provider,
  connection,
  onBack,
}: {
  vaultId: string;
  provider: SyncProvider;
  /** Present = editing an existing connection; absent = connecting a new one. */
  connection?: ProviderConnection;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const gmail = isGmail(provider.id);
  const existing = connection?.settings ?? {};

  const [days, setDays] = useState<number>(
    existing[gmail ? "gmail" : "calendar"]?.backfill_days ?? (gmail ? 90 : 365),
  );
  const [customDays, setCustomDays] = useState<string>("");
  const [labels, setLabels] = useState<string[]>(existing.gmail?.labels ?? ["INBOX"]);
  const [labelDraft, setLabelDraft] = useState("");
  const [storeBodies, setStoreBodies] = useState(Boolean(existing.gmail?.store_bodies));
  const [excludeSenders, setExcludeSenders] = useState(
    (existing.gmail?.exclude_senders ?? []).join("\n"),
  );
  const [linkDaily, setLinkDaily] = useState(existing.link_daily ?? true);
  const [linkPeople, setLinkPeople] = useState(existing.link_people ?? true);
  const [threshold, setThreshold] = useState(String(existing.people_threshold ?? 3));
  const [folderRoot, setFolderRoot] = useState(existing.folder_root ?? "");
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>(
    existing.calendar?.calendar_ids ?? ["primary"],
  );

  // Edit mode only: the calendar list needs the grant, so it cannot exist
  // before connecting. Refetched on open so a calendar made since still shows.
  const { data: calendarList } = useQuery({
    queryKey: ["sync-calendars", connection?.id],
    queryFn: () => connectionsApi.calendars(connection?.id ?? ""),
    enabled: Boolean(connection) && !gmail,
    staleTime: 60_000,
  });

  function chosenSettings(): ConnectionSettings {
    const out: ConnectionSettings = {
      folder_root: folderRoot.trim(),
      // A number input hands back a string, and the server refuses the whole
      // payload over the type of a field the user never typed.
      people_threshold: Number(threshold) || 3,
      link_daily: linkDaily,
      link_people: linkPeople,
    };
    if (gmail) {
      out.gmail = {
        backfill_days: days,
        labels: labels.length ? labels : ["INBOX"],
        store_bodies: storeBodies,
        exclude_senders: excludeSenders
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
    } else {
      out.calendar = { backfill_days: days };
      if (connection) out.calendar.calendar_ids = selectedCalendars;
    }
    return out;
  }

  const connect = useMutation({
    mutationFn: () => connectionsApi.start(vaultId, provider.id, chosenSettings()),
    onSuccess: (data) => {
      // A full navigation, not a popup: Google blocks its consent screen in
      // many popup contexts and the failure is silent when it does.
      window.location.href = data.url;
    },
    onError: (e) => toastError(e, "Could not start the connection."),
  });

  const save = useMutation({
    mutationFn: () => connectionsApi.update(connection?.id ?? "", chosenSettings()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
      toast("Saved. The change applies from the next sync.", "info");
      onBack();
    },
    // The server's message names the field it refused; inventing our own
    // wording here is how the form drifts from what the API accepts.
    onError: (e) => toastError(e, "Could not save these settings."),
  });

  const busy = connect.isPending || save.isPending;
  const customActive = !WINDOWS.some((w) => w.days === days);

  return (
    <div className="space-y-5 p-5" data-testid="sync-setup">
      {/* History window */}
      <fieldset>
        <legend className="text-[12px] font-medium text-ob-text">
          {gmail ? "How much mail to import" : "How much history to import"}
        </legend>
        <p className="mt-0.5 mb-1.5 text-[11px] text-ob-faint">
          “Future only” imports nothing old — new {gmail ? "mail" : "events"} start arriving from
          the moment you connect.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map((window) => (
            <button
              key={window.days}
              type="button"
              aria-pressed={days === window.days}
              onClick={() => setDays(window.days)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px]",
                days === window.days
                  ? "border-ob-accent bg-ob-accent/15 text-ob-text"
                  : "border-ob-border text-ob-muted hover:bg-ob-hover",
              )}
            >
              {window.label}
            </button>
          ))}
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={customActive}
              onClick={() => {
                const parsed = Number(customDays);
                if (parsed > 0) setDays(parsed);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px]",
                customActive
                  ? "border-ob-accent bg-ob-accent/15 text-ob-text"
                  : "border-ob-border text-ob-muted hover:bg-ob-hover",
              )}
            >
              Custom
            </button>
            <Input
              type="number"
              min={1}
              max={3650}
              value={customActive ? String(days) : customDays}
              onChange={(event) => {
                setCustomDays(event.target.value);
                const parsed = Number(event.target.value);
                if (parsed > 0) setDays(parsed);
              }}
              aria-label="Custom number of days"
              placeholder="days"
              className="h-7 w-20 text-[12px]"
            />
          </span>
        </div>
      </fieldset>

      {/* Calendar selection — only meaningful once the grant exists */}
      {!gmail && !connection && (
        <p className="rounded-md border border-ob-border bg-ob-bg px-3 py-2 text-[12px] text-ob-faint">
          You’ll choose which calendars to sync after connecting — your primary calendar is synced
          first.
        </p>
      )}
      {!gmail && connection && (
        <fieldset>
          <legend className="text-[12px] font-medium text-ob-text">Calendars to sync</legend>
          {calendarList?.stale && (
            <p className="mt-0.5 text-[11px] text-ob-faint">
              This list could not be refreshed just now, so it may be out of date.
            </p>
          )}
          <ul className="mt-1.5 space-y-1">
            {(calendarList?.calendars ?? existing.available_calendars ?? []).map((calendar) => (
              <li key={calendar.id}>
                <label className="flex items-center gap-2 text-[12px] text-ob-muted">
                  <input
                    type="checkbox"
                    checked={selectedCalendars.includes(calendar.id)}
                    onChange={() =>
                      setSelectedCalendars((current) =>
                        current.includes(calendar.id)
                          ? current.filter((id) => id !== calendar.id)
                          : [...current, calendar.id],
                      )
                    }
                    className="size-3.5 accent-ob-accent"
                  />
                  <span className="truncate">{calendar.summary || calendar.id}</span>
                  {calendar.primary && <span className="text-[11px] text-ob-faint">(primary)</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {/* Gmail scope */}
      {gmail && (
        <>
          <fieldset>
            <legend className="text-[12px] font-medium text-ob-text">Which mail</legend>
            <p className="mt-0.5 mb-1.5 text-[11px] text-ob-faint">
              A thread syncs if it carries any of these labels — on every sync, not just the first
              import. Archive a thread out of scope and it stops updating; the note stays.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...COMMON_LABELS, ...labels])].map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={labels.includes(label)}
                  onClick={() =>
                    setLabels((current) =>
                      current.includes(label)
                        ? current.filter((entry) => entry !== label)
                        : [...current, label],
                    )
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[12px]",
                    labels.includes(label)
                      ? "border-ob-accent bg-ob-accent/15 text-ob-text"
                      : "border-ob-border text-ob-muted hover:bg-ob-hover",
                  )}
                >
                  {label.replace("CATEGORY_", "").toLowerCase()}
                </button>
              ))}
              <Input
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && labelDraft.trim()) {
                    event.preventDefault();
                    setLabels((current) => [...new Set([...current, labelDraft.trim()])]);
                    setLabelDraft("");
                  }
                }}
                placeholder="Other label…"
                aria-label="Add another label"
                className="h-7 w-28 text-[12px]"
              />
            </div>
          </fieldset>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={storeBodies}
              onChange={(event) => setStoreBodies(event.target.checked)}
              className="mt-0.5 size-3.5 accent-ob-accent"
            />
            <span>
              <span className="text-[12px] font-medium text-ob-text">Store message bodies</span>
              <p className="text-[11px] text-ob-faint">
                Off: notes carry who wrote, when, and the subject. On: each message’s own text too —
                the quoted history below a reply is dropped either way.
              </p>
            </span>
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-ob-text">Skip these senders</span>
            <p className="mt-0.5 mb-1 text-[11px] text-ob-faint">
              Addresses or whole domains, one per line — their threads never become notes.
              Automated senders (noreply@, mailing lists) are skipped as people already.
            </p>
            <textarea
              value={excludeSenders}
              onChange={(event) => setExcludeSenders(event.target.value)}
              placeholder={"newsletter@shop.com\npromo-mail.com"}
              rows={3}
              aria-label="Senders to skip"
              className="w-full rounded-md border border-ob-border bg-ob-bg px-2 py-1.5 font-mono text-[12px] text-ob-text placeholder:text-ob-faint"
            />
          </label>
        </>
      )}

      {/* Linking */}
      <fieldset>
        <legend className="text-[12px] font-medium text-ob-text">Links into your graph</legend>
        <div className="mt-1.5 space-y-2">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={linkDaily}
              onChange={(event) => setLinkDaily(event.target.checked)}
              className="mt-0.5 size-3.5 accent-ob-accent"
            />
            <span>
              <span className="text-[12px] text-ob-text">Link each note to its daily note</span>
              <p className="text-[11px] text-ob-faint">
                {gmail ? "Threads land on the day they started." : "Events land on the day they happen."}
              </p>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={linkPeople}
              onChange={(event) => setLinkPeople(event.target.checked)}
              className="mt-0.5 size-3.5 accent-ob-accent"
            />
            <span>
              <span className="text-[12px] text-ob-text">Make notes for people</span>
              <p className="text-[11px] text-ob-faint">
                Someone becomes a <code className="rounded bg-ob-active px-1">People/</code> note —
                and a node in your graph — after appearing
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={threshold}
                  disabled={!linkPeople}
                  onChange={(event) => setThreshold(event.target.value)}
                  aria-label="Appearances before a person is linked"
                  className="mx-1.5 inline-block h-6 w-14 text-[12px]"
                />
                times. Below that, names stay plain text.
              </p>
            </span>
          </label>
        </div>
      </fieldset>

      {/* Destination */}
      <FolderPicker
        vaultId={vaultId}
        value={folderRoot}
        onChange={setFolderRoot}
        sourceFolder={sourceFolderFor(provider.id)}
      />

      {/* What this can and cannot do */}
      {!connection && provider.caveats.length > 0 && (
        <div className="nodum-import-caveats">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-ob-accent" />
          <ul className="space-y-1">
            {provider.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-ob-border pt-4">
        {connection ? (
          <Button size="sm" disabled={busy} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Save
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => connect.mutate()}>
            {connect.isPending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Connect {provider.name}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onBack}>
          Back
        </Button>
        {!connection && (
          <p className="ml-auto text-[11px] text-ob-faint">
            Google will ask you to approve read-only access.
          </p>
        )}
      </div>
    </div>
  );
}

// ── the connected list ──────────────────────────────────────────────────────

export function ConnectedList({
  connections,
  onEdit,
}: {
  connections: ProviderConnection[];
  onEdit: (connection: ProviderConnection) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });

  const syncNow = useMutation({
    mutationFn: (id: string) => connectionsApi.syncNow(id),
    onSuccess: () => {
      refresh();
      toast("Sync queued.", "info");
    },
    onError: (e) => toastError(e, "Could not start the sync."),
  });
  const pause = useMutation({
    mutationFn: (id: string) => connectionsApi.pause(id),
    onSuccess: refresh,
    onError: (e) => toastError(e, "Could not pause."),
  });
  const resume = useMutation({
    mutationFn: (id: string) => connectionsApi.resume(id),
    onSuccess: refresh,
    onError: (e) => toastError(e, "Could not resume."),
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => connectionsApi.disconnect(id),
    onSuccess: () => {
      refresh();
      toast("Disconnected. Your synced notes were kept.", "info");
    },
    onError: (e) => toastError(e, "Could not disconnect."),
  });
  const reconnect = useMutation({
    mutationFn: (connection: ProviderConnection) =>
      // The connection's own vault, not the open one: repairing a broken
      // connection elsewhere must not make a second connection here.
      connectionsApi.start(connection.vault_id, connection.provider),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (e) => toastError(e, "Could not start the connection."),
  });

  if (connections.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Connected accounts">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-ob-faint uppercase">
        Connected
      </h3>
      <ul className="space-y-2">
        {connections.map((connection) => {
          const syncing = connection.streams.some((s) => s.syncing);
          const paused = connection.status === "paused";
          const broken =
            connection.status === "needs_reauth" || connection.status === "key_unavailable";
          return (
            <li
              key={connection.id}
              className="rounded-lg border border-ob-border bg-ob-bg p-3"
              data-testid="connected-row"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ob-text">
                    {connection.provider_name}
                  </p>
                  <p className="truncate text-[12px] text-ob-muted">{connection.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!broken && !paused && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={syncing || syncNow.isPending}
                      onClick={() => syncNow.mutate(connection.id)}
                    >
                      <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
                      <span className="sr-only">Sync now</span>
                    </Button>
                  )}
                  {!broken && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pause.isPending || resume.isPending}
                      onClick={() =>
                        paused ? resume.mutate(connection.id) : pause.mutate(connection.id)
                      }
                    >
                      {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                      <span className="sr-only">{paused ? "Resume" : "Pause"}</span>
                    </Button>
                  )}
                  {!broken && (
                    <Button size="sm" variant="ghost" onClick={() => onEdit(connection)}>
                      Options
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-ob-faint hover:text-red-400"
                    onClick={() => {
                      void confirmDelete(
                        "Disconnect this account? Notes already synced are kept.",
                        "Disconnect",
                      ).then((ok) => {
                        if (ok) disconnect.mutate(connection.id);
                      });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Disconnect</span>
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <StatusPill connection={connection} />
                {connection.last_success_at && !broken && (
                  <span className="text-ob-faint">
                    Last synced {new Date(connection.last_success_at).toLocaleString()}
                  </span>
                )}
              </div>

              {!broken && Object.keys(connection.last_run).length > 0 && (
                <p className="mt-1 text-[12px] text-ob-faint">{describeRun(connection.last_run)}</p>
              )}

              {broken && (
                <div className="nodum-import-caveats mt-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-ob-accent" />
                  <div>
                    {/* The Testing-mode message is the one that actually fixes
                        the problem; generic "reconnect" advice would loop. */}
                    <p className="text-ob-text">
                      {connection.last_error || "This connection needs attention."}
                    </p>
                    {connection.status === "needs_reauth" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        onClick={() => reconnect.mutate(connection)}
                      >
                        <Link2 className="mr-1 size-3.5" />
                        Reconnect
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── shared status rendering (also used by the progress card) ────────────────

export function StatusPill({ connection }: { connection: ProviderConnection }) {
  const syncing = connection.streams.some((s) => s.syncing);
  const backfilling = connection.streams.some((s) => !s.backfill_done);
  const seen = connection.streams.reduce((total, s) => total + (s.records_seen || 0), 0);

  if (connection.status === "paused") {
    return <span className="text-ob-muted">Paused</span>;
  }
  if (syncing) {
    // A running count rather than a bar: neither Google API reports how much
    // history there is, so a percentage would be invented — and an indefinite
    // spinner over a minutes-long first import reads as a hang.
    const progress = seen > 0 ? ` ${seen.toLocaleString()} so far` : "";
    return (
      <span className="flex items-center gap-1 text-ob-accent">
        <Loader2 className="size-3 animate-spin" />
        {backfilling ? `Importing history…${progress}` : "Syncing…"}
      </span>
    );
  }
  if (connection.status === "needs_reauth") {
    return <span className="text-red-400">Disconnected by Google</span>;
  }
  if (connection.status === "key_unavailable") {
    return <span className="text-red-400">Server key unavailable</span>;
  }
  if (connection.status === "transient_broken") {
    return <span className="text-amber-400">Retrying…</span>;
  }
  if (backfilling) {
    return <span className="text-ob-muted">Waiting to import history</span>;
  }
  if (connection.failed_records > 0) {
    // "Up to date" beside a run that dropped records is the reassuring lie
    // that lets a sync bug go unnoticed for months.
    return (
      <span className="text-amber-400">
        {connection.failed_records} item{connection.failed_records === 1 ? "" : "s"} could not be
        saved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-ob-muted">
      <Check className="size-3" /> Up to date
    </span>
  );
}

/** "Last successful run: 3 new, 1 updated, 12 unchanged."
 *
 *  "Last run" would be a lie: the stats are only written when a run finishes,
 *  so a failing connection would show counts from whenever it last worked,
 *  presented as though they were current. */
export function describeRun(stats: Record<string, number>): string {
  const parts = [
    stats.created ? `${stats.created} new` : null,
    stats.updated ? `${stats.updated} updated` : null,
    stats.unchanged ? `${stats.unchanged} unchanged` : null,
    stats.tombstoned ? `${stats.tombstoned} cancelled` : null,
    stats.user_deleted ? `${stats.user_deleted} skipped (you deleted them)` : null,
    stats.left_alone ? `${stats.left_alone} left alone (no ## Notes heading)` : null,
    stats.error ? `${stats.error} failed` : null,
  ].filter(Boolean);
  return parts.length ? `Last successful run: ${parts.join(", ")}.` : "";
}
