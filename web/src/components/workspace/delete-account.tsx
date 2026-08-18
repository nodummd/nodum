"use client";

/**
 * Closing the account. Two deliberate steps — ask for a code, then type it —
 * because everything this removes (vaults, notes, attachments) is gone for
 * good, and the code proves the person pressing the button still owns the
 * mailbox rather than just a borrowed session.
 */

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

export function DeleteAccountSection({ email }: { email: string | undefined }) {
  const [stage, setStage] = useState<"idle" | "confirming" | "code">("idle");
  const [code, setCode] = useState("");
  const clearSession = useAuthStore((s) => s.logout);
  const router = useRouter();

  const requestCode = useMutation({
    mutationFn: authApi.requestAccountDeletion,
    onSuccess: () => {
      setStage("code");
      useToastStore.getState().push(`Confirmation code sent to ${email ?? "your email"}.`, "info");
    },
    onError: (e) => {
      // "One was just sent" is not a dead end — that code is in their inbox
      // and still works, so go to the code screen and say so.
      if (e instanceof ApiError && e.code === "rate_limited") {
        setStage("code");
        useToastStore.getState().push(e.message, "info");
        return;
      }
      toastError(e, "Could not send the confirmation code.");
    },
  });

  const remove = useMutation({
    mutationFn: () => authApi.deleteAccount({ code }),
    onSuccess: async () => {
      // The account is gone server-side; drop the session first so the
      // workspace does not 401 its way through a re-render on the way out.
      await clearSession().catch(() => {});
      router.replace("/");
    },
    onError: (e) => toastError(e, "Could not delete the account."),
  });

  return (
    <section className="space-y-3 border-t border-ob-border pt-4">
      <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Danger zone</h3>

      {stage === "idle" && (
        <>
          <p className="text-[12px] text-ob-faint">
            Deleting your account removes every vault, note and attachment you have. It cannot be
            undone.
          </p>
          <Button size="sm" variant="destructive" onClick={() => setStage("confirming")}>
            Delete account
          </Button>
        </>
      )}

      {stage === "confirming" && (
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-[12px] text-ob-text">
            This deletes your vaults, every note in them, and every file you have uploaded — for
            good. We&apos;ll email a confirmation code to {email} first.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => requestCode.mutate()}
              disabled={requestCode.isPending}
            >
              {requestCode.isPending ? "Sending…" : "Email me a code"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStage("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {stage === "code" && (
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          {/* The warning belongs on the screen where the irreversible button
              actually is, not only on the one before it. */}
          <p className="text-[12px] text-ob-text">
            Enter the code we sent to {email}. This deletes every vault, note and file you have,
            and cannot be undone.
          </p>
          <div className="space-y-2">
            <Label htmlFor="delete-code">Confirmation code</Label>
            <Input
              id="delete-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="font-mono tracking-[0.4em]"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || code.length < 6}
            >
              {remove.isPending ? "Deleting…" : "Delete my account permanently"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCode("");
                setStage("idle");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
