"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Link2, Loader2, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConnectionSettingsPanel } from "./connection-settings-panel";
import { confirmDelete } from "./confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  connectionsApi,
  type ProviderConnection,
  type SyncProvider,
} from "@/lib/api/endpoints";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

/**
 * Connected accounts — Google Calendar, and Gmail where the operator enabled it.
 *
 * The design job here is honesty about state. A sync connection has more ways
 * to be unwell than most features: it can be revoked, rate-limited, mid-backfill,
 * or dead because the operator's Google project is still in "Testing" mode. A
 * green tick that means "we last tried" is worse than useless, so every state
 * says what it is and, where the user can fix it, what to do.
 */
export function ConnectionsSettingsTab({ vaultId }: { vaultId: string }) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);

  const { data: catalog, isPending: catalogPending } = useQuery({
    queryKey: ["sync-providers"],
    queryFn: () => connectionsApi.providers(),
  });
  // A manual sync is queued for a worker, so for a few seconds afterwards
  // nothing is marked as syncing yet. Without this window the button would
  // appear to do nothing at all until the next page load.
  const [pollUntil, setPollUntil] = useState(0);

  const { data: connections } = useQuery({
    queryKey: ["sync-connections"],
    queryFn: () => connectionsApi.list(),
    // A backfill runs in the background; poll so progress is visible without
    // making the user reload the page to find out whether it worked.
    refetchInterval: (query) => {
      const running = (query.state.data ?? []).some((c) => c.streams.some((s) => s.syncing));
      return running || Date.now() < pollUntil ? 3000 : false;
    },
  });

  const connect = useMutation({
    // The vault is a parameter rather than always `vaultId`: reconnecting a
    // broken connection has to target the vault that connection belongs to.
    // Aimed at the open vault instead, it silently makes a *second*
    // connection here and leaves the broken one exactly as it was.
    mutationFn: ({ provider, vault }: { provider: string; vault: string }) =>
      connectionsApi.start(vault, provider),
    onSuccess: (data) => {
      // A full navigation, not a popup: Google blocks its consent screen in
      // many popup contexts and the failure is silent when it does.
      window.location.href = data.url;
    },
    onError: (e) => toastError(e, "Could not start the connection."),
  });

  const syncNow = useMutation({
    mutationFn: (id: string) => connectionsApi.syncNow(id),
    onSuccess: () => {
      // 60 seconds is enough for a worker to pick the job up and claim its
      // lease, which is when the row starts reporting itself as syncing.
      setPollUntil(Date.now() + 60_000);
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
      toast("Sync queued. The first run can take a few minutes.", "info");
    },
    onError: (e) => toastError(e, "Could not start the sync."),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => connectionsApi.disconnect(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
      toast("Disconnected. Your synced notes were kept.", "info");
    },
    onError: (e) => toastError(e, "Could not disconnect."),
  });

  // This tab lives inside one vault's settings, every Connect button targets
  // that vault, and the copy above says "this vault" — but the endpoint
  // returns every connection the *account* has. Left unfiltered, opening
  // Settings in one vault listed connections that sync into another, with
  // nothing saying so.
  const connected = (connections ?? []).filter((c) => c.vault_id === vaultId);
  const providers = catalog?.providers ?? [];
  const connectedIds = new Set(connected.map((c) => c.provider));

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          Connected accounts
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ob-faint">
          Keep a source in sync with this vault. Nodum only ever reads — it never creates, edits
          or deletes anything in the connected account — and everything it writes lands above a{" "}
          <code className="rounded bg-ob-active px-1">## Notes</code> heading, so anything you
          write underneath is never touched by a later sync.
        </p>
      </div>

      {catalogPending && <p className="text-[13px] text-ob-faint">Loading…</p>}

      {catalog && !catalog.configured && (
        <div className="nodum-import-caveats">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-ob-accent" />
          <div>
            <p className="text-ob-text">Google sync is not configured on this server.</p>
            <p className="mt-1">
              An administrator needs to register a Google Cloud OAuth client and set{" "}
              <code>GOOGLE_SYNC_CLIENT_ID</code> and <code>GOOGLE_SYNC_CLIENT_SECRET</code>. The
              project must also be published — an OAuth consent screen left in “Testing” expires
              every connection after 7 days.
            </p>
          </div>
        </div>
      )}

      {connected.length > 0 && (
        <ul className="space-y-2">
          {connected.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              busy={syncNow.isPending || disconnect.isPending}
              onSync={() => syncNow.mutate(connection.id)}
              onReconnect={() =>
                connect.mutate({ provider: connection.provider, vault: connection.vault_id })
              }
              onDisconnect={() =>
                void confirmDelete(
                  `Disconnect ${connection.provider_name}? Notes already synced into this vault are kept — only the connection is removed.`,
                ).then((ok) => {
                  if (ok) disconnect.mutate(connection.id);
                })
              }
            />
          ))}
        </ul>
      )}

      {catalog?.configured && (
        <div>
          <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
            Available
          </h3>
          <ul className="mt-2 space-y-2">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                alreadyConnected={connectedIds.has(provider.id)}
                busy={connect.isPending}
                onConnect={() => connect.mutate({ provider: provider.id, vault: vaultId })}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ConnectionRow({
  connection,
  busy,
  onSync,
  onReconnect,
  onDisconnect,
}: {
  connection: ProviderConnection;
  busy: boolean;
  onSync: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const syncing = connection.streams.some((s) => s.syncing);
  const backfilling = connection.streams.some((s) => !s.backfill_done);
  const seen = connection.streams.reduce((total, s) => total + (s.records_seen || 0), 0);
  const broken = connection.status === "needs_reauth" || connection.status === "key_unavailable";

  return (
    <li className="rounded-lg border border-ob-border bg-ob-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ob-text">{connection.provider_name}</p>
          <p className="truncate text-[12px] text-ob-muted">{connection.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!broken && (
            <Button size="sm" variant="ghost" disabled={busy || syncing} onClick={onSync}>
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} strokeWidth={2} />
              <span className="sr-only">Sync now</span>
            </Button>
          )}
          {!broken && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((open) => !open)}
            >
              <Settings2 className="size-3.5" strokeWidth={2} />
              <ChevronDown
                className={cn("size-3 transition-transform", showSettings && "rotate-180")}
                strokeWidth={2}
              />
              <span className="sr-only">Sync settings</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDisconnect}
            className="text-ob-faint hover:text-red-400"
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
            <span className="sr-only">Disconnect</span>
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <StatusPill
          connection={connection}
          syncing={syncing}
          backfilling={backfilling}
          seen={seen}
        />
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
            {/* The Testing-mode message is the one that actually fixes the
                problem. Showing the generic "reconnect" advice here would put
                the user in a loop that breaks again every seventh day. */}
            <p className="text-ob-text">{connection.last_error || "This connection needs attention."}</p>
            {connection.status === "needs_reauth" && (
              <Button size="sm" variant="secondary" className="mt-2" onClick={onReconnect}>
                <Link2 className="mr-1 size-3.5" strokeWidth={2} />
                Reconnect
              </Button>
            )}
          </div>
        </div>
      )}

      {showSettings && !broken && <ConnectionSettingsPanel connection={connection} />}
    </li>
  );
}

/** "Last successful run: 3 new, 1 updated, 12 unchanged."
 *
 *  "Last run" would be a lie: the stats are only written when a run finishes,
 *  so a connection that is currently failing would show counts from whenever
 *  it last worked, presented as though they were current. */
function describeRun(stats: Record<string, number>): string {
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

function StatusPill({
  connection,
  syncing,
  backfilling,
  seen,
}: {
  connection: ProviderConnection;
  syncing: boolean;
  backfilling: boolean;
  seen: number;
}) {
  if (syncing) {
    // A running count rather than a bar. Neither Google API reports how much
    // history there is, so a percentage would be made up — and an indefinite
    // spinner during a first import that takes several minutes reads as a
    // hang. A number that keeps going up is honest and visibly alive.
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
    // "Up to date" next to a run that dropped records is exactly the kind of
    // reassuring lie that lets a sync bug go unnoticed for months.
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

function ProviderRow({
  provider,
  alreadyConnected,
  busy,
  onConnect,
}: {
  provider: SyncProvider;
  alreadyConnected: boolean;
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <li className="rounded-lg border border-ob-border bg-ob-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ob-text">{provider.name}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ob-muted">{provider.blurb}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          disabled={busy || !provider.available}
          onClick={onConnect}
        >
          {alreadyConnected ? "Connect another" : "Connect"}
        </Button>
      </div>

      {provider.caveats.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px] text-ob-faint">
          {provider.caveats.map((caveat) => (
            <li key={caveat}>· {caveat}</li>
          ))}
        </ul>
      )}

      {!provider.available && (
        <p className="mt-2 text-[12px] text-ob-faint">
          Not enabled on this server. {provider.name}&rsquo;s API permissions oblige a hosted
          service to carry a paid annual security audit, so it is available on self-hosted
          instances only.
        </p>
      )}
    </li>
  );
}
