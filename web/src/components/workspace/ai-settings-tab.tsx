"use client";

/**
 * Settings → AI. Bring your own key.
 *
 * The key is sent once and never comes back: everything shown here comes from
 * /ai/status, which reports which providers are configured and a hint like
 * `sk-ant…7f2a`. There is deliberately no way to read a stored key back out.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiApi } from "@/lib/api/endpoints";
import type { AIProviderInfo } from "@/lib/api/types";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

export function AiSettingsTab({ vaultId, vaultName }: { vaultId: string; vaultName?: string }) {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const { data: status } = useQuery({
    queryKey: ["ai-status", vaultId],
    queryFn: () => aiApi.status(vaultId),
  });

  // Keys live in two scopes: the account's (every vault) and this vault's own,
  // which wins here when it has any. The form edits one scope at a time.
  const [scope, setScope] = useState<"account" | "vault">("account");
  const scoped = scope === "vault" ? status?.vault : status?.account;
  const scopeVaultId = scope === "vault" ? vaultId : undefined;

  const [provider, setProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  const providers = status?.providers ?? [];
  // With nothing chosen yet, start from the scope's active provider — or the
  // account's, so a vault key for the same provider is one paste away.
  const selected: AIProviderInfo | undefined =
    providers.find(
      (p) => p.id === (provider ?? scoped?.active_provider ?? status?.account.active_provider),
    ) ?? providers[0];
  const existing = scoped?.credentials.find((c) => c.provider === selected?.id);
  const modelValue = model ?? existing?.model ?? selected?.default_model ?? "";
  const baseUrlValue = baseUrl ?? existing?.base_url ?? "";

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-status"] });
  const resetForm = () => {
    setModel(null);
    setBaseUrl(null);
    setApiKey("");
  };

  const save = useMutation({
    mutationFn: () =>
      aiApi.saveCredential({
        provider: selected?.id ?? "",
        api_key: apiKey.trim() || undefined,
        model: modelValue,
        base_url: baseUrlValue.trim() || undefined,
        vault_id: scopeVaultId,
      }),
    onSuccess: () => {
      setApiKey("");
      void refresh();
      toast(scope === "vault" ? "AI settings saved for this vault." : "AI settings saved.", "info");
    },
    onError: (e) => toastError(e, "Could not save the AI settings."),
  });

  const test = useMutation({
    mutationFn: () => aiApi.test(selected?.id ?? "", scopeVaultId),
    onSuccess: (data) => toast(`${data.model} answered — the key works.`, "info"),
    onError: (e) => toastError(e, "The provider did not accept that key."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => aiApi.removeCredential(id, scopeVaultId),
    onSuccess: () => {
      void refresh();
      toast("Key removed.", "info");
    },
    onError: (e) => toastError(e, "Could not remove the key."),
  });

  if (status && !status.available) {
    return (
      <section className="space-y-3">
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">AI</h3>
        <p className="text-[13px] text-ob-muted">
          This server has no <code>AI_ENCRYPTION_KEY</code> configured, so it cannot store an API key
          safely. Set one and restart the server to turn the AI features on.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">AI provider</h3>
        <p className="text-[12px] text-ob-faint">
          Nodum has no AI of its own — you connect your own account. Your key is encrypted before it
          is stored, is never sent to the browser again, and is used only for requests you make.
          Usage is billed by the provider to you, under their terms.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Keys for</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Scope of the AI key">
          {(
            [
              ["account", "Your account (every vault)"],
              ["vault", `Only this vault${vaultName ? ` — ${vaultName}` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={scope === id}
              onClick={() => {
                setScope(id);
                setProvider(null);
                resetForm();
              }}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                scope === id
                  ? "border-ob-accent bg-ob-active text-ob-text"
                  : "border-ob-border text-ob-muted hover:bg-ob-hover hover:text-ob-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ob-faint">
          {scope === "vault"
            ? "A key saved here is used for chat in this vault only, instead of the account's."
            : "Used in every vault that has no key of its own."}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {providers.map((p) => {
          const configured = scoped?.credentials.some((c) => c.provider === p.id);
          const active = p.id === selected?.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setProvider(p.id);
                resetForm();
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                active
                  ? "border-ob-accent bg-ob-active text-ob-text"
                  : "border-ob-border text-ob-muted hover:bg-ob-hover hover:text-ob-text",
              )}
            >
              {configured && <Check className="size-3 text-ob-accent" strokeWidth={3} />}
              {p.label}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-key">
              API key
              {existing ? (
                <span className="ml-2 font-normal text-ob-faint">
                  stored: {existing.key_hint} — paste a new one to replace it
                </span>
              ) : null}
            </Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={existing ? "•••••••••••••" : "Paste your key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <a
              href={selected.key_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-ob-accent hover:underline"
            >
              Get a {selected.label} key
              <ExternalLink className="size-3" strokeWidth={2} />
            </a>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              list="ai-model-options"
              value={modelValue}
              onChange={(e) => setModel(e.target.value)}
              placeholder={selected.default_model}
            />
            {/* A list, not a select: providers ship models faster than we ship
                releases, and a typed name has to keep working. */}
            <datalist id="ai-model-options">
              {selected.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-base-url">
              Endpoint <span className="font-normal text-ob-faint">optional</span>
            </Label>
            <Input
              id="ai-base-url"
              value={baseUrlValue}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Leave empty for the provider's default"
            />
            <p className="text-[12px] text-ob-faint">
              For a self-hosted, proxied or regional endpoint.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={save.isPending || (!apiKey.trim() && !existing)}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!existing || test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
            {existing && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${selected.label} key`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(selected.id)}
                className="ml-auto text-ob-faint hover:text-red-400"
              >
                <Trash2 className="mr-1 size-3.5" strokeWidth={2} />
                Remove key
              </Button>
            )}
          </div>
        </div>
      )}

      {status?.configured && (
        <p className="text-[12px] text-ob-faint" data-testid="ai-effective">
          Chat in this vault uses <span className="text-ob-muted">{status.active_provider}</span> ·{" "}
          <span className="text-ob-muted">{status.active_model}</span>
          {status.effective_scope === "vault" ? " (this vault's own key)" : " (the account key)"}.
          Saving a key makes that provider the active one for its scope.
        </p>
      )}
    </section>
  );
}
