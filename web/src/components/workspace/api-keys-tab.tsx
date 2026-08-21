"use client";

/**
 * Settings → API keys. The credential for the public REST API.
 *
 * Creation lives in its own dialog (ApiKeyCreateModal): name + scopes, then
 * the key shown exactly once with a ready-made curl. This tab is the calm
 * part — what the API is, the base URL, and the list of live keys with
 * their scopes and a revoke button.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiKeyCreateModal } from "@/components/workspace/api-key-create-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiKeysApi } from "@/lib/api/endpoints";
import { DOCS_URL } from "@/lib/app-meta";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

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
  const [creating, setCreating] = useState(false);

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
  const templateCurl = `curl -H "Authorization: Bearer <your key>" ${baseUrl}/vaults`;

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
        <div className="flex items-center gap-2">
          <Label>Keys</Label>
          <span className="text-[11px] text-ob-faint">
            A key is a password for one program; changing your password revokes them all.
          </span>
          <span className="flex-1" />
          <Button size="sm" onClick={() => setCreating(true)}>
            <KeyRound className="mr-1 size-3.5" strokeWidth={2} />
            Create key
          </Button>
        </div>

        {live.length > 0 ? (
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
        ) : (
          <p className="rounded-md border border-dashed border-ob-border px-2.5 py-2 text-[12px] text-ob-faint">
            No keys yet — create one and it will be shown exactly once.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label>Try it</Label>
          <span className="text-[11px] text-ob-faint">A fresh key drops straight into this shape.</span>
          <span className="flex-1" />
          <CopyButton text={templateCurl} label="Copy curl command" />
        </div>
        <pre className="rounded border border-ob-border bg-ob-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ob-muted [overflow-wrap:anywhere]">
          {templateCurl}
        </pre>
      </div>

      <ApiKeyCreateModal open={creating} onOpenChange={setCreating} baseUrl={baseUrl} />
    </section>
  );
}
