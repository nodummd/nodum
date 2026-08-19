"use client";

/**
 * The one-time Demo Workspace question.
 *
 * A populated vault — 200+ linked notes, coloured folders, graph groups — so a
 * new user can see what Nodum does before they have written anything. Asked
 * once (`demoOffered` on the user), whatever the answer; creatable again later
 * from Settings → Vault, since a demo is just a vault.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authApi, vaultApi } from "@/lib/api/endpoints";
import { useUserPrefs } from "@/lib/hooks/use-editor-settings";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

/** Remember first-run answers on the user, optimistically — a prompt must not
 *  reappear while its PATCH is in flight. Two of these can be in flight at
 *  once (the tour finishing and the demo answered in the same click), and the
 *  server merges settings, so a reply is applied over the local settings rather
 *  than replacing them: whichever PATCH answers first must not undo the other. */
export function useRememberFirstRun(patch: Record<string, unknown>) {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: () => authApi.updateMe({ settings: patch }),
    onMutate: () => {
      const current = useAuthStore.getState().user;
      if (current) setUser({ ...current, settings: { ...current.settings, ...patch } });
    },
    onSuccess: (updated) => {
      const current = useAuthStore.getState().user;
      setUser({ ...updated, settings: { ...current?.settings, ...updated.settings, ...patch } });
    },
  });
}

function useRememberOffered(also: Record<string, unknown> = {}) {
  return useRememberFirstRun({ demoOffered: true, ...also });
}

/** Create the demo vault and go there. Shared by the dialog, the onboarding
 *  step and Settings → Vault. `alsoRemember` rides in the same PATCH as
 *  `demoOffered` — the tour passes `onboardingDone`, and one write beats two
 *  in flight (the server merges settings under a row lock, but a lost update
 *  is still cheaper to avoid than to guard). */
export function useCreateDemoWorkspace(
  onCreated?: () => void,
  alsoRemember: Record<string, unknown> = {},
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const remember = useRememberOffered(alsoRemember);
  return useMutation({
    mutationFn: () => vaultApi.createDemo(),
    onSuccess: (data) => {
      remember.mutate();
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast(`${data.vault.name} is ready — ${data.imported} notes to explore.`, "info");
      onCreated?.();
      // Settings lives in the store, so it would stay open across the vault
      // change below and hide the new workspace behind itself.
      useWorkspaceStore.getState().setSettingsOpen(false);
      // In place, not a new tab: this is a first-run moment, there is nothing
      // in the current tab worth keeping, and a popup here would be blocked
      // (it follows an await).
      const note = data.open_note_id ? `?note=${data.open_note_id}` : "";
      router.push(`/vault/${data.vault.id}${note}`);
    },
    onError: (e) => toastError(e, "Could not create the demo workspace."),
  });
}

/** The card's body — used inside the dialog and as an onboarding step. */
export function DemoWorkspaceCard({
  onCreated,
  onDecline,
  compact = false,
  alsoRemember = {},
}: {
  onCreated?: () => void;
  onDecline: () => void;
  compact?: boolean;
  /** Extra settings to store together with the answer (see useCreateDemoWorkspace). */
  alsoRemember?: Record<string, unknown>;
}) {
  const { data: info } = useQuery({ queryKey: ["demo-info"], queryFn: vaultApi.describeDemo });
  const create = useCreateDemoWorkspace(onCreated, alsoRemember);
  const remember = useRememberOffered();

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <p className="text-[13px] leading-relaxed text-ob-muted">
        {info?.description ??
          "A populated vault, all linked, with folder colours and graph groups already set — so you can explore how Nodum works before writing a word."}
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ob-faint">
        <li>{info?.note_count ?? "200+"} linked notes</li>
        <li>Maps of content to start from</li>
        <li>Coloured folders and graph groups</li>
        <li>Daily notes and templates</li>
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Create demo workspace"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={create.isPending}
          onClick={() => {
            remember.mutate();
            onDecline();
          }}
        >
          Not now
        </Button>
      </div>
      <p className="text-[11px] text-ob-faint">
        It becomes a separate vault of yours — delete it whenever you like. You can also create it
        later from Settings → Vault.
      </p>
    </div>
  );
}

/** Auto-shown once for a user who has never been asked. */
export function DemoWorkspaceOffer() {
  const { demoOffered, onboardingDone } = useUserPrefs();
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();
  // The tour asks this as its last step, so on desktop the dialog only fires
  // for an account that finished the tour without being asked. On mobile the
  // tour does not run at all, and the dialog is the one place to ask.
  const open = Boolean(user) && !demoOffered && (onboardingDone || isMobile);
  const remember = useRememberOffered();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remember.mutate(); // Esc / × counts as "not now"
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="demo-offer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-ob-accent" strokeWidth={2} />
            Want a Demo Workspace?
          </DialogTitle>
          <DialogDescription>See how Nodum works with real notes and links.</DialogDescription>
        </DialogHeader>
        <DemoWorkspaceCard onDecline={() => remember.mutate()} />
      </DialogContent>
    </Dialog>
  );
}
