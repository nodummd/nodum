"use client";

/**
 * Settings → API keys. The credential for the public REST API.
 *
 * A key is shown once, at the moment it is minted, and never again — the list
 * below only ever carries its name, scopes, last four characters and when it
 * was last used. The moment a key exists this screen hands the user a working
 * curl with it filled in: zero to a first successful request in one paste.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiKeysApi } from "@/lib/api/endpoints";
import { DOCS_URL } from "@/lib/app-meta";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

const SCOPES = [
  { id: "read", label: "Read", hint: "list, read, search, graph" },
  { id: "write", label: "Write", hint: "create, edit, link, tag" },
  { id: "delete", label: "Delete", hint: "delete notes & files" },
  { id: "ai", label: "AI", hint: "ask the vault (can write via AI tools)" },
] as const;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — the text is selectable */
        }
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded text-ob-faint hover:bg-ob-hover hover:text-ob-text"
    >
      {done ? <Check className="size-3.5 text-ob-accent" strokeWidth={2.5} /> : <Copy className="size-3.5" strokeWidth={2} />}
    </button>
  );
}

export function ApiKeysTab() {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const { data } = useQuery({ queryKey: ["api-keys"], queryFn: apiKeysApi.list });
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read", "write"]);
  // The one and only time a key is visible.
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);

  const create = useMutation({
    mutationFn: () => apiKeysApi.create(name.trim() || "API key", scopes),
    onSuccess: (k) => {
      setFresh({ token: k.token, name: k.name });
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => toastError(e, "Could not create the key."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast("Key revoked.", "info");
    },
    onError: (e) => toastError(e, "Could not revoke the key."),
  });

  const baseUrl =
    data?.base_url ?? `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/v1`;
  const live = (data?.keys ?? []).filter((k) => !k.revoked_at);
  const curl = fresh
    ? `curl -H "Authorization: Bearer ${fresh.token}" ${baseUrl}/vaults`
    : `curl -H "Authorization: Bearer <your key>" ${baseUrl}/vaults`;

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          API keys — connect your own apps
        </h3>
        <p className="text-[12px] text-ob-faint">
          A plain REST API over everything here: notes, search, links, tags, the graph, AI. Create a
          key, pick what it may do, and call the URL below from any language.{" "}
          <a href={`${DOCS_URL}/api`} target="_blank" rel="noopener noreferrer" className="text-ob-accent hover:underline">
            Read the guide
          </a>{" "}
          or open the{" "}
          <a href="/api-reference" target="_blank" rel="noopener noreferrer" className="text-ob-accent hover:underline">
            interactive API reference
          </a>
          .
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Base URL</Label>
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 rounded border border-ob-border bg-ob-bg px-2 py-1.5 font-mono text-[12px] text-ob-text [overflow-wrap:anywhere]">
            {baseUrl}
          </code>
          <CopyButton text={baseUrl} label="Copy base URL" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="api-key-name">Create a key</Label>
        <p className="text-[12px] text-ob-faint">
          A key is a password for one program. Name it after where it lives; revoke it here when that
          program goes. Changing your password revokes every key.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="api-key-name"
            placeholder="My sync script"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !create.isPending && scopes.length > 0) create.mutate();
            }}
            className="h-8"
          />
          <Button
            size="sm"
            disabled={create.isPending || scopes.length === 0}
            onClick={() => create.mutate()}
          >
            <KeyRound className="mr-1 size-3.5" strokeWidth={2} />
            Create key
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {SCOPES.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ob-text">
              <input
                type="checkbox"
                checked={scopes.includes(s.id)}
                onChange={(e) =>
                  setScopes((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))
                }
                className="accent-ob-accent"
              />
              {s.label}
              <span className="text-ob-faint">({s.hint})</span>
            </label>
          ))}
        </div>
        {scopes.length === 0 && (
          <p className="text-[12px] text-red-400">Pick at least one scope.</p>
        )}

        {fresh && (
          <div
            data-testid="api-fresh-key"
            className="space-y-1.5 rounded-md border border-ob-accent/60 bg-ob-bg p-2.5"
          >
            <p className="text-[12px] text-ob-text">
              Copy <span className="font-medium">{fresh.name}</span> now — it is not shown again.
            </p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 font-mono text-[12px] text-ob-text [overflow-wrap:anywhere]">
                {fresh.token}
              </code>
              <CopyButton text={fresh.token} label="Copy key" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label>Try it</Label>
          <span className="text-[11px] text-ob-faint">
            {fresh ? "This includes the key you just created." : "Create a key and it fills in."}
          </span>
          <span className="flex-1" />
          <CopyButton text={curl} label="Copy curl command" />
        </div>
        <pre
          data-testid="api-curl"
          className="rounded border border-ob-border bg-ob-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ob-muted [overflow-wrap:anywhere]"
        >
          {curl}
        </pre>
      </div>

      {live.length > 0 && (
        <div className="space-y-1.5">
          <Label>Active keys</Label>
          <ul className="divide-y divide-ob-border rounded-md border border-ob-border">
            {live.map((k) => (
              <li key={k.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                <span className="truncate text-ob-text">{k.name}</span>
                <span className="shrink-0 text-ob-faint">{k.scopes.join(" · ")}</span>
                <span className="font-mono text-ob-faint">…{k.hint}</span>
                <span className="ml-auto shrink-0 text-ob-faint">
                  {k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}
                </span>
                <button
                  type="button"
                  aria-label={`Revoke key ${k.name}`}
                  onClick={() => revoke.mutate(k.id)}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-ob-faint hover:text-red-400"
                >
                  <Trash2 className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
