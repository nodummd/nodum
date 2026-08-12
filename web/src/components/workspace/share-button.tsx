"use client";

/** Share button — publish/unpublish the active note, copy the public link. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { publishApi } from "@/lib/api/endpoints";
import { toastError } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

export function ShareButton({ vaultId, noteId }: { vaultId: string; noteId: string }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["publish", vaultId, noteId],
    queryFn: () => publishApi.status(vaultId, noteId),
  });

  const publish = useMutation({
    mutationFn: () => publishApi.publish(vaultId, noteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["publish", vaultId, noteId] }),
    onError: (e) => toastError(e, "Could not publish."),
  });
  const unpublish = useMutation({
    mutationFn: () => publishApi.unpublish(vaultId, noteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["publish", vaultId, noteId] }),
    onError: (e) => toastError(e, "Could not unpublish."),
  });

  const publicUrl = status?.token ? `${window.location.origin}/p/${status.token}` : null;

  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Popover>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Share note"
              className={cn(
                "flex size-6 items-center justify-center rounded transition-colors duration-150",
                status?.published
                  ? "text-ob-accent"
                  : "text-ob-faint hover:bg-ob-hover hover:text-ob-text",
              )}
            >
              {status?.published ? (
                <Globe className="size-3.5" strokeWidth={1.75} />
              ) : (
                <Share2 className="size-3.5" strokeWidth={1.75} />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{status?.published ? "Published" : "Share"}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80 border-ob-border bg-ob-sidebar">
        {status?.published && publicUrl ? (
          <div className="space-y-3">
            <p className="text-[13px] font-medium text-ob-text">This note is public</p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-ob-bg px-2 py-1.5 text-[12px] text-ob-muted">
                {publicUrl}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copyLink()} aria-label="Copy link">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => unpublish.mutate()}
              disabled={unpublish.isPending}
            >
              Unpublish
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-ob-muted">
              Publish this note to get a public read-only link anyone can open.
            </p>
            <Button
              size="sm"
              className="w-full"
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
            >
              Publish note
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
