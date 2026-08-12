"use client";

/** Settings modal (⌘,) — account, daily notes, templates. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, vaultApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";

interface SettingsModalProps {
  vaultId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ vaultId, open, onOpenChange }: SettingsModalProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const toast = useToastStore((s) => s.push);

  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list, enabled: open });
  const vault = vaults?.find((v) => v.id === vaultId);
  const settings = (vault?.settings ?? {}) as Record<string, string>;

  const [name, setName] = useState<string | null>(null);
  const [dailyFormat, setDailyFormat] = useState<string | null>(null);
  const [dailyFolder, setDailyFolder] = useState<string | null>(null);
  const [dailyTemplate, setDailyTemplate] = useState<string | null>(null);
  const [templatesFolder, setTemplatesFolder] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const saveProfile = useMutation({
    mutationFn: () => authApi.updateMe({ name: name ?? undefined }),
    onSuccess: () => {
      toast("Profile saved.", "info");
    },
    onError: (e) => toastError(e, "Could not save profile."),
  });

  const saveVault = useMutation({
    mutationFn: () =>
      vaultApi.update(vaultId, {
        settings: {
          dailyNoteFormat: dailyFormat ?? settings.dailyNoteFormat ?? "YYYY-MM-DD",
          dailyNoteFolder: dailyFolder ?? settings.dailyNoteFolder ?? "",
          dailyNoteTemplate: dailyTemplate ?? settings.dailyNoteTemplate ?? "",
          templatesFolder: templatesFolder ?? settings.templatesFolder ?? "Templates",
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      void queryClient.invalidateQueries({ queryKey: ["templates", vaultId] });
      toast("Vault settings saved.", "info");
    },
    onError: (e) => toastError(e, "Could not save vault settings."),
  });

  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword({ current_password: currentPw, new_password: newPw }),
    onSuccess: () => {
      setCurrentPw("");
      setNewPw("");
      toast("Password changed — all sessions were logged out.", "info");
    },
    onError: (e) => toastError(e, "Could not change password."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto border-ob-border bg-ob-sidebar sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Account and vault configuration.</DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Account</h3>
          <div className="space-y-2">
            <Label htmlFor="settings-name">Display name</Label>
            <Input
              id="settings-name"
              value={name ?? user?.name ?? ""}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="text-[12px] text-ob-faint">Signed in as {user?.email}</p>
          <Button size="sm" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
            Save profile
          </Button>
        </section>

        <section className="space-y-3 border-t border-ob-border pt-4">
          <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Daily notes</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="daily-format">Date format</Label>
              <Input
                id="daily-format"
                placeholder="YYYY-MM-DD"
                value={dailyFormat ?? settings.dailyNoteFormat ?? ""}
                onChange={(e) => setDailyFormat(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-folder">Folder</Label>
              <Input
                id="daily-folder"
                placeholder="Journal"
                value={dailyFolder ?? settings.dailyNoteFolder ?? ""}
                onChange={(e) => setDailyFolder(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-template">Template note path</Label>
            <Input
              id="daily-template"
              placeholder="Templates/Daily"
              value={dailyTemplate ?? settings.dailyNoteTemplate ?? ""}
              onChange={(e) => setDailyTemplate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="templates-folder">Templates folder</Label>
            <Input
              id="templates-folder"
              placeholder="Templates"
              value={templatesFolder ?? settings.templatesFolder ?? ""}
              onChange={(e) => setTemplatesFolder(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => saveVault.mutate()} disabled={saveVault.isPending}>
            Save vault settings
          </Button>
        </section>

        <section className="space-y-3 border-t border-ob-border pt-4">
          <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Password</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pw-current">Current</Label>
              <Input
                id="pw-current"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-new">New (min 8)</Label>
              <Input id="pw-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => changePassword.mutate()}
            disabled={changePassword.isPending || !currentPw || newPw.length < 8}
          >
            Change password
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
