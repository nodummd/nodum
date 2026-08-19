"use client";

/**
 * Settings → MCP. Nodum as a tool server for any MCP client.
 *
 * A token is shown once, at the moment it is minted, and never again — the
 * list below only ever carries its name, its last four characters and when it
 * was last used. Everything else on this screen is copy-and-paste: the
 * endpoint URL and a ready-made config block for each common client.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mcpApi } from "@/lib/api/endpoints";
import { DOCS_URL } from "@/lib/app-meta";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

const TOKEN_PLACEHOLDER = "<your token>";

/** The config snippets, with the real endpoint and the token slot. */
function snippets(endpoint: string, token: string) {
  const bearer = `Bearer ${token}`;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      hint: "One command, in a terminal.",
      code: `claude mcp add --transport http nodum ${endpoint} --header "Authorization: ${bearer}"`,
    },
    {
      id: "cursor",
      label: "Cursor",
      hint: "In ~/.cursor/mcp.json (or the project's .cursor/mcp.json).",
      code: JSON.stringify(
        { mcpServers: { nodum: { url: endpoint, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      hint: "Claude Desktop speaks stdio; mcp-remote bridges it to this URL. In claude_desktop_config.json:",
      // The header value goes through env: Claude Desktop on Windows (and
      // Cursor) split an args entry at its first space, so "Bearer <token>"
      // must not appear inside args. mcp-remote expands ${AUTH_HEADER}.
      code: JSON.stringify(
        {
          mcpServers: {
            nodum: {
              command: "npx",
              args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: bearer },
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

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

export function McpSettingsTab() {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const { data } = useQuery({ queryKey: ["mcp-tokens"], queryFn: mcpApi.tokens });
  const [name, setName] = useState("");
  // The one and only time a token is visible.
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);

  const create = useMutation({
    mutationFn: () => mcpApi.createToken(name.trim() || "MCP client"),
    onSuccess: (t) => {
      setFresh({ token: t.token, name: t.name });
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] });
    },
    onError: (e) => toastError(e, "Could not create the token."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => mcpApi.revokeToken(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] });
      toast("Token revoked.", "info");
    },
    onError: (e) => toastError(e, "Could not revoke the token."),
  });

  const endpoint = data?.endpoint ?? `${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/mcp`;
  const live = (data?.tokens ?? []).filter((t) => !t.revoked_at);
  const shownToken = fresh?.token ?? TOKEN_PLACEHOLDER;

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
          MCP — use Nodum from an AI client
        </h3>
        <p className="text-[12px] text-ob-faint">
          Nodum is an MCP server. Point Claude Code, Claude Desktop, Cursor or any other MCP client at
          the URL below with a token, and it can do everything you can here — create vaults, write and
          link notes, colour folders, search, import, export.{" "}
          <a href={`${DOCS_URL}/mcp`} target="_blank" rel="noopener noreferrer" className="text-ob-accent hover:underline">
            Read the guide
          </a>
          .
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Server URL</Label>
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 rounded border border-ob-border bg-ob-bg px-2 py-1.5 font-mono text-[12px] text-ob-text [overflow-wrap:anywhere]">
            {endpoint}
          </code>
          <CopyButton text={endpoint} label="Copy server URL" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-token-name">Tokens</Label>
        <p className="text-[12px] text-ob-faint">
          A token is a password for one client. Name it after where it lives; revoke it here when that
          machine goes.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="mcp-token-name"
            placeholder="Claude Desktop on my laptop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !create.isPending) create.mutate();
            }}
            className="h-8"
          />
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
            <KeyRound className="mr-1 size-3.5" strokeWidth={2} />
            Create token
          </Button>
        </div>

        {fresh && (
          <div
            data-testid="mcp-fresh-token"
            className="space-y-1.5 rounded-md border border-ob-accent/60 bg-ob-bg p-2.5"
          >
            <p className="text-[12px] text-ob-text">
              Copy <span className="font-medium">{fresh.name}</span> now — it is not shown again.
            </p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 font-mono text-[12px] text-ob-text [overflow-wrap:anywhere]">
                {fresh.token}
              </code>
              <CopyButton text={fresh.token} label="Copy token" />
            </div>
          </div>
        )}

        {live.length > 0 && (
          <ul className="divide-y divide-ob-border rounded-md border border-ob-border">
            {live.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                <span className="truncate text-ob-text">{t.name}</span>
                <span className="font-mono text-ob-faint">…{t.hint}</span>
                <span className="ml-auto shrink-0 text-ob-faint">
                  {t.last_used_at ? `used ${new Date(t.last_used_at).toLocaleDateString()}` : "never used"}
                </span>
                <button
                  type="button"
                  aria-label={`Revoke token ${t.name}`}
                  onClick={() => revoke.mutate(t.id)}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-ob-faint hover:text-red-400"
                >
                  <Trash2 className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label>Connect a client</Label>
        <p className="text-[12px] text-ob-faint">
          {fresh
            ? "These include the token you just created."
            : `Create a token above and these fill in; until then they show ${TOKEN_PLACEHOLDER}.`}
        </p>
        {snippets(endpoint, shownToken).map((s) => (
          <div key={s.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-ob-text">{s.label}</span>
              <span className="text-[11px] text-ob-faint">{s.hint}</span>
              <span className="flex-1" />
              <CopyButton text={s.code} label={`Copy ${s.label} config`} />
            </div>
            <pre
              // Wrapped, not scrolled: a 200-character one-liner with a token
              // in it otherwise widens the whole settings pane past the dialog.
              className={cn(
                "rounded border border-ob-border bg-ob-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ob-muted [overflow-wrap:anywhere]",
              )}
            >
              {s.code}
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
