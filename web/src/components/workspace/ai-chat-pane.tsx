"use client";

/**
 * AI chat panel — talk to your own model about your own vault.
 *
 * The key never comes near this component: every turn goes to the backend,
 * which decrypts the user's key, calls the provider, runs any vault tools the
 * model asked for, and returns the reply plus a record of what it changed.
 *
 * The transcript lives on the server, not here. Only the new message is sent;
 * the history comes back from the conversation, so a reload, a second device or
 * a cleared browser all keep the thread. Reopening the panel restores the chat
 * you were last in.
 *
 * Not configured is a first-class state, not an error: the panel explains what
 * is missing and opens the settings tab that fixes it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FilePlus2, History, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { ReadingView } from "@/components/editor/reading-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aiApi } from "@/lib/api/endpoints";
import type { AIAction, AIConversationMessage, Note } from "@/lib/api/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toastError } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

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

  // Which thread is showing, as an intent rather than an id — so "the most
  // recent one" survives the list loading, and "new chat" is not immediately
  // undone by it. Derived below; no effect syncs anything.
  type Selection = { mode: "auto" } | { mode: "new" } | { mode: "pick"; id: string };
  const [selection, setSelection] = useState<Selection>({ mode: "auto" });
  // Turns taken in this panel since the last load, layered over the stored
  // transcript so the reply appears without a refetch.
  const [pending, setPending] = useState<AIConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const configured = Boolean(status?.configured);
  const { data: conversations } = useQuery({
    queryKey: ["ai-conversations", vaultId],
    queryFn: () => aiApi.conversations(vaultId),
    enabled: configured,
  });
  // Reopening the panel returns to the thread you were last in — the point of
  // keeping history at all.
  const conversationId =
    selection.mode === "pick"
      ? selection.id
      : selection.mode === "new"
        ? null
        : (conversations?.[0]?.id ?? null);

  const { data: conversation } = useQuery({
    queryKey: ["ai-conversation", vaultId, conversationId],
    queryFn: () => aiApi.conversation(vaultId, conversationId as string),
    enabled: configured && conversationId !== null,
  });

  const messages: AIConversationMessage[] = [...(conversation?.messages ?? []), ...pending];

  const scrollToEnd = () => requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6 }));

  const send = useMutation({
    mutationFn: async (text: string) => {
      // Whatever note is open goes along as context, so "summarise this" works.
      const open = noteId ? queryClient.getQueryData<Note>(["note", vaultId, noteId]) : undefined;
      const context = open ? `# ${open.title}\n\n${open.content.slice(0, CONTEXT_CHARS)}` : "";
      return aiApi.vaultChat(vaultId, {
        message: text,
        conversation_id: conversationId ?? undefined,
        context,
      });
    },
    onMutate: (text: string) => {
      setPending((m) => [...m, { role: "user", content: text, actions: [] }]);
      setDraft("");
      scrollToEnd();
    },
    onSuccess: (data) => {
      setPending((m) => [
        ...m,
        { role: "assistant", content: data.reply, actions: data.actions ?? [] },
      ]);
      // The turn is stored now; adopt its thread and let the queries catch up.
      setSelection({ mode: "pick", id: data.conversation_id });
      void queryClient.invalidateQueries({ queryKey: ["ai-conversations", vaultId] });
      void queryClient
        .invalidateQueries({ queryKey: ["ai-conversation", vaultId, data.conversation_id] })
        // Once the stored transcript includes this turn, the local copy would
        // double it.
        .then(() => setPending([]));
      if ((data.actions ?? []).length > 0) {
        void queryClient.invalidateQueries({ queryKey: ["tree", vaultId] });
        void queryClient.invalidateQueries({ queryKey: ["graph", vaultId] });
        void queryClient.invalidateQueries({ queryKey: ["backlinks", vaultId] });
      }
      scrollToEnd();
    },
    onError: (e, text) => {
      toastError(e, "The AI request failed.");
      // Nothing was stored, so drop the optimistic question and hand it back.
      setPending((m) => m.filter((msg) => msg.content !== text || msg.role !== "user"));
      setDraft(text);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => aiApi.deleteConversation(vaultId, id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ["ai-conversations", vaultId] });
      if (id === conversationId) {
        setSelection({ mode: "auto" }); // fall back to the next most recent
        setPending([]);
      }
    },
    onError: (e) => toastError(e, "Could not delete that chat."),
  });

  if (isLoading) {
    return <p className="p-2 text-[13px] text-ob-faint">Loading…</p>;
  }

  if (!configured) {
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

  const startNewChat = () => {
    setSelection({ mode: "new" });
    setPending([]);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-ob-border px-1 pb-1.5 text-[11px] text-ob-faint">
        <span className="truncate">
          {status?.active_provider} · {status?.active_model}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chat history"
                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ob-hover hover:text-ob-text"
              >
                <History className="size-3.5" strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-[11px] tracking-wide text-ob-faint uppercase">
                Chats in this vault
              </DropdownMenuLabel>
              {(conversations ?? []).length === 0 && (
                <p className="px-2 py-1.5 text-[12px] text-ob-faint">Nothing saved yet.</p>
              )}
              {(conversations ?? []).map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={() => {
                    setSelection({ mode: "pick", id: c.id });
                    setPending([]);
                    scrollToEnd();
                  }}
                >
                  {c.id === conversationId ? (
                    <Check className="mr-2 size-3.5 shrink-0 text-ob-accent" strokeWidth={2.5} />
                  ) : (
                    <span className="mr-2 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{c.title}</span>
                  <button
                    type="button"
                    aria-label={`Delete chat ${c.title}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove.mutate(c.id);
                    }}
                    className="ml-auto shrink-0 text-ob-faint hover:text-red-400"
                  >
                    <Trash2 className="size-3" strokeWidth={2} />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={startNewChat}>
                <Plus className="mr-2 size-3.5 shrink-0" strokeWidth={2} />
                New chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label="New chat"
            onClick={startNewChat}
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ob-hover hover:text-ob-text"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
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
            {/* Every vault change is shown, never silent — and it is stored with
                the message, so a restored thread still shows what was written. */}
            {(message.actions ?? []).map((action: AIAction) => (
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
