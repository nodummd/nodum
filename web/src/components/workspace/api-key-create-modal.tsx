"use client";

/**
 * The create-an-API-key dialog: name + scopes → Create → the key, shown once,
 * with a copy button and a ready-made curl. Closing the dialog is the moment
 * the key disappears forever, so the shown-once phase says exactly that and
 * offers nothing but copy and Done.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiKeysApi } from "@/lib/api/endpoints";
import { toastError } from "@/lib/stores/toast-store";

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

export function ApiKeyCreateModal({
  open,
  onOpenChange,
  baseUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read", "write"]);
  // The one and only time a key is visible.
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);

  const create = useMutation({
    mutationFn: () => apiKeysApi.create(name.trim() || "API key", scopes),
    onSuccess: (k) => {
      setFresh({ token: k.token, name: k.name });
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => toastError(e, "Could not create the key."),
  });

  const close = (next: boolean) => {
    if (!next) {
      // Closing forgets everything — especially the key.
      setFresh(null);
      setName("");
      setScopes(["read", "write"]);
      create.reset();
    }
    onOpenChange(next);
  };

  const curl = fresh ? `curl -H "Authorization: Bearer ${fresh.token}" ${baseUrl}/vaults` : "";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        {!fresh ? (
          <>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                A key is a password for one program. Name it after where it will live, and give it
                only what it needs.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-modal-name">Name</Label>
                <Input
                  id="api-key-modal-name"
                  placeholder="My sync script"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !create.isPending && scopes.length > 0) create.mutate();
                  }}
                  className="h-8"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Scopes</Label>
                <div className="flex flex-col gap-1.5">
                  {SCOPES.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ob-text"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(s.id)}
                        onChange={(e) =>
                          setScopes((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                          )
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
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={create.isPending || scopes.length === 0} onClick={() => create.mutate()}>
                <KeyRound className="mr-1 size-3.5" strokeWidth={2} />
                Create key
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your key now</DialogTitle>
              <DialogDescription>
                This is the only time <span className="font-medium">{fresh.name}</span> is shown.
                Close this dialog and it is gone for good — revoking and re-creating is the only way
                back.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3" data-testid="api-fresh-key">
              <div className="flex items-center gap-1.5 rounded-md border border-ob-accent/60 bg-ob-bg p-2.5">
                <code className="min-w-0 flex-1 font-mono text-[12px] text-ob-text [overflow-wrap:anywhere]">
                  {fresh.token}
                </code>
                <CopyButton text={fresh.token} label="Copy key" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label>Try it</Label>
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
            </div>
            <DialogFooter>
              <Button size="sm" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
