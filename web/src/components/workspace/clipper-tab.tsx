"use client";

/** Web Clipper settings — issue and revoke the extension's scoped token. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { clipperApi } from "@/lib/api/endpoints";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

export function ClipperTab() {
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  // Shown once, right after minting — the server only keeps a hash.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["clipper-token"], queryFn: clipperApi.status });

  const issue = useMutation({
    mutationFn: clipperApi.issue,
    onSuccess: (res) => {
      setFreshToken(res.token);
      void queryClient.invalidateQueries({ queryKey: ["clipper-token"] });
    },
    onError: (e) => toastError(e, "Could not generate a token."),
  });

  const revoke = useMutation({
    mutationFn: clipperApi.revoke,
    onSuccess: () => {
      setFreshToken(null);
      void queryClient.invalidateQueries({ queryKey: ["clipper-token"] });
      toast("Clipper token revoked", "info");
    },
    onError: (e) => toastError(e, "Could not revoke the token."),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Web Clipper</h3>
      <p className="text-[12px] text-ob-muted">
        Clip pages straight into this vault with the browser extension. The extension uses its own
        token — it can only create notes, never read or delete them, and revoking it here does not
        touch your login.
      </p>

      {freshToken && (
        <div className="space-y-1.5 rounded border border-ob-accent/40 bg-ob-accent/5 p-2.5">
          <p className="text-[12px] text-ob-text">
            Copy this now — it isn’t shown again.
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-ob-border bg-ob-bg px-2 py-1 font-mono text-[11px] text-ob-text">
              {freshToken}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(freshToken)
                  .then(() => toast("Token copied", "info"))
                  .catch(() => toastError(null, "Could not copy."));
              }}
              className="shrink-0 rounded border border-ob-border px-2 text-[12px] text-ob-muted hover:text-ob-text"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => issue.mutate()}
          disabled={issue.isPending}
          className="rounded bg-ob-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
        >
          {data?.configured ? "Regenerate token" : "Generate token"}
        </button>
        {data?.configured && (
          <button
            type="button"
            onClick={() => revoke.mutate()}
            className="rounded border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
          >
            Revoke
          </button>
        )}
        <span className="text-[12px] text-ob-faint">
          {data?.configured ? "A token is active." : "No token yet."}
        </span>
      </div>

      <ol className="list-decimal space-y-1 pl-4 text-[12px] text-ob-muted">
        <li>Generate a token above and copy it.</li>
        <li>
          Load the <code className="text-ob-text">clipper/</code> folder as an unpacked extension
          (chrome://extensions → Developer mode → Load unpacked).
        </li>
        <li>Open the extension, paste your server URL and the token, then Connect.</li>
      </ol>
    </section>
  );
}
