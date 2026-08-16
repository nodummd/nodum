"use client";

/**
 * AI chat panel — talk to your own model about your own vault.
 *
 * The key never comes near this component: every turn goes to the backend,
 * which decrypts the user's key, calls the provider, runs any vault tools the
 * model asked for, and returns the reply plus a record of what it changed.
 *
 * Not configured is a first-class state, not an error: the panel explains what
 * is missing and opens the settings tab that fixes it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, RefreshCw, Send, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { ReadingView } from "@/components/editor/reading-view";
import { Button } from "@/components/ui/button";
import { aiApi, noteApi } from "@/lib/api/endpoints";
import type { Note } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toastError } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

interface Action {
  kind: string;
  title: string;
  note_id: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: Action[];
}

const CONTEXT_CHARS = 4_000;

export function AiChatPane({
  vaultId,
  noteId,
  onOpenNote,
}: {
  vaultId: string;
  noteId: string | null;
  onOpenNote: (noteId: string, title: string) => void;
}) {
  const queryClient = useQueryClient();
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const { data: status, isLoading } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status });
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async (text: string) => {
      // Whatever note is open goes along as context, so "summarise this" works.
      const open = noteId ? queryClient.getQueryData<Note>(["note", vaultId, noteId]) : undefined;
      const context = open ? `# ${open.title}\n\n${open.content.slice(0, CONTEXT_CHARS)}` : "";
      const history = [...messages, { role: "user" as const, content: text }];
      return aiApi.vaultChat(vaultId, {
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        context,
      });
    },
    onMutate: (text: string) => {
      setMessages((m) => [...m, { role: "user", content: text }]);
      setDraft("");
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6 }));
    },
    onSuccess: (data) => {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply, actions: data.actions ?? [] },
      ]);
      // The assistant may have written notes — the tree, graph and backlinks
      // are all stale now.
      if ((data.actions ?? []).length > 0) {
        void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
        void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
        void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
      }
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6 }));
    },
    onError: (e) => {
      toastError(e, "The AI request failed.");
      // Put the question back so it is not lost with the failure.
      setMessages((m) => {
        const last = m.at(-1);
        if (last?.role === "user") {
          setDraft(last.content);
          return m.slice(0, -1);
        }
        return m;
      });
    },
  });

  if (isLoading) {
    return <p className="p-2 text-[13px] text-ob-faint">Loading…</p>;
  }

  if (!status?.configured) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-3 p-4 text-[13px]">
        <Sparkles className="size-5 text-ob-accent" strokeWidth={1.75} />
        <p className="font-medium text-ob-text">AI is not set up yet</p>
        <p className="text-ob-muted">
          {status?.available === false
            ? "This server has no encryption key configured, so it cannot store an API key. Ask whoever runs it to set AI_ENCRYPTION_KEY."
            : "Nodum uses your own AI account. Add a key for Claude, OpenAI, Gemini or Qwen and this panel can search, write and link your notes."}
        </p>
        {status?.available !== false && (
          <Button size="sm" onClick={() => openSettings("AI")}>
            Set up AI
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ob-border px-1 pb-1.5 text-[11px] text-ob-faint">
        <span className="truncate">
          {status.active_provider} · {status.active_model}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ob-hover hover:text-ob-text"
          >
            <RefreshCw className="size-3" strokeWidth={2} />
            New chat
          </button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="px-1 text-[13px] text-ob-faint">
            Ask about your notes, or ask for one to be written. It can search, read, create and
            extend notes in this vault.
          </p>
        )}
        {messages.map((message, i) => (
          <div key={i} className="space-y-1.5">
            <p className="px-1 text-[11px] font-medium tracking-wide text-ob-faint uppercase">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <div
              className={cn(
                "rounded-md px-2 py-1.5 text-[13px]",
                message.role === "user" ? "bg-ob-active text-ob-text" : "bg-ob-bg text-ob-muted",
              )}
            >
              {message.role === "assistant" ? (
                <ReadingView
                  content={message.content}
                  vaultId={vaultId}
                  onNavigate={() => undefined}
                />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
            </div>
            {/* Every vault change is shown, never silent. */}
            {(message.actions ?? []).map((action) => (
              <button
                key={`${action.note_id}-${action.kind}`}
                type="button"
                onClick={() => onOpenNote(action.note_id, action.title)}
                className="flex w-full items-center gap-1.5 rounded border border-ob-border px-2 py-1 text-left text-[12px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
              >
                <FilePlus2 className="size-3.5 shrink-0 text-ob-accent" strokeWidth={2} />
                <span className="truncate">
                  {action.kind === "created" ? "Created" : "Updated"} {action.title}
                </span>
              </button>
            ))}
          </div>
        ))}
        {send.isPending && <p className="px-1 text-[13px] text-ob-faint">Thinking…</p>}
      </div>

      <form
        className="flex items-end gap-1.5 border-t border-ob-border pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text && !send.isPending) send.mutate(text);
        }}
      >
        <textarea
          aria-label="Message the assistant"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline — chat convention.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const text = draft.trim();
              if (text && !send.isPending) send.mutate(text);
            }
          }}
          placeholder="Ask about this vault…"
          className="min-h-[3.5rem] flex-1 resize-none rounded border border-ob-border bg-ob-bg px-2 py-1.5 text-[13px] text-ob-text outline-none placeholder:text-ob-faint focus:border-ob-accent"
        />
        <Button
          type="submit"
          size="sm"
          aria-label="Send"
          disabled={!draft.trim() || send.isPending}
          className="mb-0.5"
        >
          <Send className="size-3.5" strokeWidth={2} />
        </Button>
      </form>
    </div>
  );
}
