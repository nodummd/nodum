"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect } from "react";

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
  const { data: connections } = useQuery({
    queryKey: ["sync-connections"],
    queryFn: () => connectionsApi.list(),
    // A backfill runs in the background; poll so progress is visible without
    // making the user reload the page to find out whether it worked.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => c.streams.some((s) => s.syncing)) ? 4000 : false,
  });

  // Google bounces the browser back to /vault?connected=… after consent.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("connected");
    if (!status) return;
    if (status === "ok") {
      toast("Account connected. The first sync is starting.", "info");
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
    } else if (status === "denied") {
      toast("Connection cancelled.", "info");
    } else {
      toast("Could not complete the connection. Please try again.", "error");
    }
    params.delete("connected");
    params.delete("detail");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [queryClient, toast]);

  const connect = useMutation({
    mutationFn: (provider: string) => connectionsApi.start(vaultId, provider),
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
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
      toast("Sync started.", "info");
    },
    onError: (e) => toastError(e, "Sync failed."),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => connectionsApi.disconnect(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sync-connections"] });
      toast("Disconnected. Your synced notes were kept.", "info");
    },
    onError: (e) => toastError(e, "Could not disconnect."),
  });

  const connected = connections ?? [];
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
              onReconnect={() => connect.mutate(connection.provider)}
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
                onConnect={() => connect.mutate(provider.id)}
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
  const syncing = connection.streams.some((s) => s.syncing);
  const backfilling = connection.streams.some((s) => !s.backfill_done);
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
        <StatusPill connection={connection} syncing={syncing} backfilling={backfilling} />
        {connection.last_success_at && !broken && (
          <span className="text-ob-faint">
            Last synced {new Date(connection.last_success_at).toLocaleString()}
          </span>
        )}
      </div>

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
    </li>
  );
}

function StatusPill({
  connection,
  syncing,
  backfilling,
}: {
  connection: ProviderConnection;
  syncing: boolean;
  backfilling: boolean;
}) {
  if (syncing) {
    return (
      <span className="flex items-center gap-1 text-ob-accent">
        <Loader2 className="size-3 animate-spin" />
        {backfilling ? "Importing history…" : "Syncing…"}
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
