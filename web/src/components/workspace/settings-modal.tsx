"use client";

/**
 * Settings window (⌘,) — Obsidian-style vertical-tab layout.
 * Account prefs live on the user, locations/formats on the vault.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { AiSettingsTab } from "./ai-settings-tab";
import { ClipperTab } from "./clipper-tab";
import { DeleteAccountSection } from "./delete-account";
import { McpSettingsTab } from "./mcp-settings-tab";
import { PluginsTab } from "./plugins-tab";
import { VaultsSection } from "./vaults-section";
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
import { authApi, siteApi, vaultApi } from "@/lib/api/endpoints";
import { APP_VERSION, DOCS_URL, HELP_URL } from "@/lib/app-meta";
import { filterHotkeys, HOTKEY_SECTIONS } from "@/lib/hotkeys";
import {
  FONT_CHOICES,
  useEditorSettings,
  useUserPrefs,
  type EditorViewMode,
  type FontChoice,
} from "@/lib/hooks/use-editor-settings";
import { useVaultSettings } from "@/lib/hooks/use-vault-settings";
import { useAuthStore } from "@/lib/stores/auth-store";
import { toastError, useToastStore } from "@/lib/stores/toast-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const TABS = [
  "General",
  "Editor",
  "Appearance",
  "Interface",
  "Files & links",
  "Hotkeys",
  "Vault",
  "Canvas",
  "Plugins",
  "AI",
  "MCP",
  "Web Clipper",
  "Publish",
  "Collab",
] as const;
type SettingsTab = (typeof TABS)[number];

interface SettingsModalProps {
  vaultId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ vaultId, open, onOpenChange }: SettingsModalProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const toast = useToastStore((s) => s.push);
  // Deep link: openSettings("Vault") from anywhere lands on that tab. Derived
  // rather than synced by an effect — a click on any tab takes over from then
  // on, and closing the dialog forgets the choice.
  const requestedTab = useWorkspaceStore((s) => s.settingsTab);
  const [pickedTab, setPickedTab] = useState<SettingsTab | null>(null);
  const tab: SettingsTab =
    pickedTab ??
    ((TABS as readonly string[]).includes(requestedTab ?? "")
      ? (requestedTab as SettingsTab)
      : "General");
  const setTab = setPickedTab;
  const [hotkeyQuery, setHotkeyQuery] = useState("");
  const editorSettings = useEditorSettings();
  const userPrefs = useUserPrefs();
  const vaultSettings = useVaultSettings(vaultId);

  const { data: vaults } = useQuery({ queryKey: ["vaults"], queryFn: vaultApi.list, enabled: open });
  const vault = vaults?.find((v) => v.id === vaultId);
  const settings = (vault?.settings ?? {}) as Record<string, string>;

  const [name, setName] = useState<string | null>(null);
  const [dailyFormat, setDailyFormat] = useState<string | null>(null);
  const [dailyFolder, setDailyFolder] = useState<string | null>(null);
  const [dailyTemplate, setDailyTemplate] = useState<string | null>(null);
  const [templatesFolder, setTemplatesFolder] = useState<string | null>(null);
  const [collabDraft, setCollabDraft] = useState<boolean | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const saveProfile = useMutation({
    mutationFn: () => authApi.updateMe({ name: name ?? undefined }),
    onSuccess: () => {
      toast("Profile saved.", "info");
    },
    onError: (e) => toastError(e, "Could not save profile."),
  });

  const { data: siteStatus } = useQuery({
    queryKey: ["site-status", vaultId],
    queryFn: () => siteApi.status(vaultId),
    enabled: open,
  });
  const siteToggle = useMutation({
    mutationFn: async (enable: boolean): Promise<void> => {
      if (enable) await siteApi.publish(vaultId);
      else await siteApi.unpublish(vaultId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["site-status", vaultId] });
      toast("Site publishing updated.", "info");
    },
    onError: (e) => toastError(e, "Could not update site publishing."),
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

  // Editor prefs save themselves on change (users.settings is shallow-merged).
  // Applied optimistically so the editor updates the instant a toggle flips;
  // the server response (or an error rollback) reconciles afterwards.
  const saveEditorSettings = useMutation({
    mutationFn: (patch: Record<string, unknown>) => authApi.updateMe({ settings: patch }),
    onMutate: (patch) => {
      const current = useAuthStore.getState().user;
      if (current) setUser({ ...current, settings: { ...current.settings, ...patch } });
      return { previous: current };
    },
    onSuccess: (updated) => {
      setUser(updated);
      toast("Editor settings saved.", "info");
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.previous) setUser(ctx.previous);
      toastError(e, "Could not save editor settings.");
    },
  });
  // Slider drags fire per-step — debounce so one release = one PATCH
  const [fontSizeDraft, setFontSizeDraft] = useState<number | null>(null);
  const fontSizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFontSizeChange = (value: number) => {
    setFontSizeDraft(value);
    if (fontSizeTimer.current) clearTimeout(fontSizeTimer.current);
    fontSizeTimer.current = setTimeout(
      () => saveEditorSettings.mutate({ editorFontSize: value }),
      400,
    );
  };

  // Collab lives on its own tab, so the toggle saves itself (backend merges patches)
  const saveCollab = useMutation({
    mutationFn: (enabled: boolean) =>
      vaultApi.update(vaultId, { settings: { collabEnabled: enabled } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast("Collaboration setting saved.", "info");
    },
    onError: (e) => toastError(e, "Could not update collaboration."),
  });

  // Files & links vault-level prefs — immediate patch saves
  const saveVaultPatch = useMutation({
    mutationFn: (patch: Record<string, unknown>) => vaultApi.update(vaultId, { settings: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast("Vault settings saved.", "info");
    },
    onError: (e) => toastError(e, "Could not save vault settings."),
  });
  const [newNoteFolderDraft, setNewNoteFolderDraft] = useState<string | null>(null);
  const newNoteFolderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNewNoteFolderChange = (value: string) => {
    setNewNoteFolderDraft(value);
    if (newNoteFolderTimer.current) clearTimeout(newNoteFolderTimer.current);
    newNoteFolderTimer.current = setTimeout(
      () => saveVaultPatch.mutate({ newNoteFolder: value.trim() }),
      500,
    );
  };
  // Text inputs on the Files & links tab debounce their PATCH like above.
  const [attachmentDraft, setAttachmentDraft] = useState<string | null>(null);
  const attachmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAttachmentFolderChange = (value: string) => {
    setAttachmentDraft(value);
    if (attachmentTimer.current) clearTimeout(attachmentTimer.current);
    attachmentTimer.current = setTimeout(
      () => saveVaultPatch.mutate({ attachmentFolder: value.trim() }),
      500,
    );
  };
  const [excludedDraft, setExcludedDraft] = useState<string | null>(null);
  const excludedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExcludedChange = (value: string) => {
    setExcludedDraft(value);
    if (excludedTimer.current) clearTimeout(excludedTimer.current);
    excludedTimer.current = setTimeout(
      () =>
        saveVaultPatch.mutate({
          excludedPaths: value
            .split("\n")
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      500,
    );
  };
  // Accent colour drags fire per-frame — debounce like the font slider
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const accentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAccentChange = (value: string) => {
    setAccentDraft(value);
    if (accentTimer.current) clearTimeout(accentTimer.current);
    accentTimer.current = setTimeout(() => saveEditorSettings.mutate({ accentColor: value }), 400);
  };

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPickedTab(null); // reopening honours the next deep link
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-0 overflow-clip border-ob-border bg-ob-sidebar p-0 sm:max-w-[1040px]">
        <DialogHeader className="border-b border-ob-border px-5 pt-4 pb-3">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Account and vault configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[min(660px,82vh)] min-h-0 flex-col sm:flex-row">
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 flex-row gap-0.5 overflow-x-auto border-b border-ob-border p-2 sm:w-44 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-r sm:border-b-0"
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100",
                  tab === t
                    ? "bg-ob-active text-ob-text"
                    : "text-ob-muted hover:bg-ob-hover hover:text-ob-text",
                )}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {tab === "Plugins" && <PluginsTab vaultId={vaultId} />}
            {tab === "AI" && <AiSettingsTab vaultId={vaultId} vaultName={vault?.name} />}
            {tab === "MCP" && <McpSettingsTab />}

            {tab === "Web Clipper" && <ClipperTab />}

            {tab === "General" && (
              <>
                <section className="space-y-2">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    About
                  </h3>
                  <div className="flex items-center justify-between gap-4 text-[13px] text-ob-muted">
                    <span>
                      Version {APP_VERSION}
                      <span className="block text-[11px] text-ob-faint">nodum — open-source</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          useWorkspaceStore.getState().setTourOpen(true);
                        }}
                        className="rounded-md border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
                      >
                        Show the tour again
                      </button>
                      <a
                        href={DOCS_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-md border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
                      >
                        Documentation
                      </a>
                      <a
                        href={HELP_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-md border border-ob-border px-2.5 py-1 text-[12px] text-ob-muted hover:text-ob-text"
                      >
                        GitHub
                      </a>
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t border-ob-border pt-4">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    Account
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="settings-name">Display name</Label>
                    <Input
                      id="settings-name"
                      value={name ?? user?.name ?? ""}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <p className="text-[12px] text-ob-faint">Signed in as {user?.email}</p>
                  <Button
                    size="sm"
                    onClick={() => saveProfile.mutate()}
                    disabled={saveProfile.isPending}
                  >
                    Save profile
                  </Button>
                </section>

                <section className="space-y-3 border-t border-ob-border pt-4">
                  <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                    Password
                  </h3>
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
                      <Input
                        id="pw-new"
                        type="password"
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                      />
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

                <DeleteAccountSection email={user?.email} />
              </>
            )}

            {tab === "Editor" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Editor
                </h3>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="default-view-mode" className="font-normal text-ob-muted">
                    Default view for new tabs
                  </Label>
                  <select
                    id="default-view-mode"
                    value={editorSettings.defaultViewMode}
                    onChange={(e) =>
                      saveEditorSettings.mutate({
                        defaultViewMode: e.target.value as EditorViewMode,
                      })
                    }
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="live">Live preview</option>
                    <option value="source">Source mode</option>
                    <option value="reading">Reading view</option>
                  </select>
                </div>

                <SettingToggle
                  label="Readable line length"
                  hint="Limit the editing column to a comfortable width."
                  checked={editorSettings.readableLineLength}
                  onChange={(v) => saveEditorSettings.mutate({ readableLineLength: v })}
                />
                <SettingToggle
                  label="Show line numbers"
                  hint="Display a line-number gutter in the editor."
                  checked={editorSettings.showLineNumbers}
                  onChange={(v) => saveEditorSettings.mutate({ showLineNumbers: v })}
                />
                <SettingToggle
                  label="Spellcheck"
                  hint="Underline misspelled words while editing."
                  checked={editorSettings.spellcheck}
                  onChange={(v) => saveEditorSettings.mutate({ spellcheck: v })}
                />

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="editor-font-size" className="font-normal text-ob-muted">
                      Editor font size
                    </Label>
                    <span className="text-[12px] text-ob-faint">
                      {fontSizeDraft ?? editorSettings.editorFontSize}px
                    </span>
                  </div>
                  <input
                    id="editor-font-size"
                    type="range"
                    min={14}
                    max={24}
                    step={1}
                    value={fontSizeDraft ?? editorSettings.editorFontSize}
                    onChange={(e) => onFontSizeChange(Number(e.target.value))}
                    className="w-full accent-[var(--ob-interactive-accent)]"
                  />
                </div>
              </section>
            )}

            {tab === "Appearance" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Appearance
                </h3>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="accent-color" className="font-normal text-ob-muted">
                    Accent colour
                    <span className="block text-[11px] font-normal text-ob-faint">
                      Used for buttons, links and highlights.
                    </span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="accent-color"
                      type="color"
                      aria-label="Accent colour"
                      value={accentDraft ?? userPrefs.accentColor ?? "#8b78e6"}
                      onChange={(e) => onAccentChange(e.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-ob-border bg-transparent"
                    />
                    {(accentDraft ?? userPrefs.accentColor) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAccentDraft(null);
                          saveEditorSettings.mutate({ accentColor: null });
                        }}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="scheme" className="font-normal text-ob-muted">
                    Colour scheme
                    <span className="block text-[11px] font-normal text-ob-faint">
                      Light theme is not available yet — nodum is dark-only.
                    </span>
                  </Label>
                  <select
                    id="scheme"
                    disabled
                    value="dark"
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-faint"
                  >
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <FontSelect
                  id="font-interface"
                  label="Interface font"
                  value={userPrefs.fontInterface}
                  onChange={(v) => saveEditorSettings.mutate({ fontInterface: v })}
                />
                <FontSelect
                  id="font-text"
                  label="Text font"
                  value={userPrefs.fontText}
                  onChange={(v) => saveEditorSettings.mutate({ fontText: v })}
                />
                <FontSelect
                  id="font-monospace"
                  label="Monospace font"
                  value={userPrefs.fontMonospace}
                  onChange={(v) => saveEditorSettings.mutate({ fontMonospace: v })}
                />
              </section>
            )}

            {tab === "Interface" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Interface
                </h3>
                <SettingToggle
                  label="Show ribbon"
                  hint="The narrow icon strip on the far left."
                  checked={userPrefs.showRibbon}
                  onChange={(v) => saveEditorSettings.mutate({ showRibbon: v })}
                />
                <SettingToggle
                  label="Show tab title bar"
                  hint="The row of tabs above each editor pane."
                  checked={userPrefs.showTabTitleBar}
                  onChange={(v) => saveEditorSettings.mutate({ showTabTitleBar: v })}
                />
              </section>
            )}

            {tab === "Files & links" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Files &amp; links
                </h3>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="new-note-location" className="font-normal text-ob-muted">
                    Default location for new notes
                  </Label>
                  <select
                    id="new-note-location"
                    value={(settings.newNoteLocation as string) ?? "root"}
                    onChange={(e) => saveVaultPatch.mutate({ newNoteLocation: e.target.value })}
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="root">Vault root</option>
                    <option value="current">Same folder as current note</option>
                    <option value="folder">In the folder specified below</option>
                  </select>
                </div>
                {((settings.newNoteLocation as string) ?? "root") === "folder" && (
                  <div className="space-y-2">
                    <Label htmlFor="new-note-folder">New note folder</Label>
                    <Input
                      id="new-note-folder"
                      placeholder="Inbox"
                      value={newNoteFolderDraft ?? (settings.newNoteFolder as string) ?? ""}
                      onChange={(e) => onNewNoteFolderChange(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="attachment-folder">Attachment folder</Label>
                  <Input
                    id="attachment-folder"
                    placeholder="Attachments"
                    value={attachmentDraft ?? vaultSettings.attachmentFolder}
                    onChange={(e) => onAttachmentFolderChange(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="link-format" className="font-normal text-ob-muted">
                    New link format
                  </Label>
                  <select
                    id="link-format"
                    value={vaultSettings.linkFormat}
                    onChange={(e) => saveVaultPatch.mutate({ linkFormat: e.target.value })}
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="shortest">Shortest path</option>
                    <option value="relative">Relative path</option>
                    <option value="absolute">Absolute path</option>
                  </select>
                </div>

                <SettingToggle
                  label="Use [[Wikilinks]]"
                  hint="Generate wikilinks instead of Markdown links."
                  checked={vaultSettings.useWikilinks}
                  onChange={(v) => saveVaultPatch.mutate({ useWikilinks: v })}
                />
                <SettingToggle
                  label="Confirm before deleting"
                  hint="Ask for confirmation when deleting notes, folders and canvases."
                  checked={userPrefs.confirmDelete}
                  onChange={(v) => saveEditorSettings.mutate({ confirmDelete: v })}
                />
                <SettingToggle
                  label="Page preview requires ⌘/Ctrl"
                  hint="Only show the hover preview while the modifier key is held."
                  checked={userPrefs.previewRequireCmd}
                  onChange={(v) => saveEditorSettings.mutate({ previewRequireCmd: v })}
                />

                <div className="space-y-2">
                  <Label htmlFor="excluded-paths">Excluded files</Label>
                  <textarea
                    id="excluded-paths"
                    rows={3}
                    placeholder={"One path per line\nArchive/\nprivate.md"}
                    value={excludedDraft ?? vaultSettings.excludedPaths.join("\n")}
                    onChange={(e) => onExcludedChange(e.target.value)}
                    className="w-full rounded-md border border-ob-border bg-ob-primary px-2 py-1.5 text-[13px] text-ob-text outline-none placeholder:text-ob-faint"
                  />
                </div>
              </section>
            )}

            {tab === "Hotkeys" && (
              <HotkeysTab query={hotkeyQuery} onQuery={setHotkeyQuery} />
            )}

            {tab === "Vault" && (
              <section className="space-y-6">
                <VaultsSection vaultId={vaultId} />
                <div className="space-y-3">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Daily notes
                </h3>
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
                </div>
              </section>
            )}

            {tab === "Canvas" && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Canvas
                </h3>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="canvas-bg" className="font-normal text-ob-muted">
                    Background
                    <span className="block text-[11px] font-normal text-ob-faint">
                      Board pattern for all canvases in this vault.
                    </span>
                  </Label>
                  <select
                    id="canvas-bg"
                    aria-label="Canvas background"
                    value={(settings.canvasBackground as string) ?? "dots"}
                    onChange={(e) => saveVaultPatch.mutate({ canvasBackground: e.target.value })}
                    className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
                  >
                    <option value="dots">Dots</option>
                    <option value="grid">Grid</option>
                    <option value="blank">Blank</option>
                  </select>
                </div>
              </section>
            )}

            {tab === "Publish" && (
              <section className="space-y-3">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Publish site
                </h3>
                {siteStatus?.enabled && siteStatus.slug ? (
                  <div className="space-y-2">
                    <p className="text-[13px] text-ob-muted">
                      Live at{" "}
                      <a
                        href={`/s/${siteStatus.slug}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-ob-accent hover:underline"
                      >
                        /s/{siteStatus.slug}
                      </a>{" "}
                      — notes with <code className="text-ob-faint">publish: false</code> stay
                      private.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => siteToggle.mutate(false)}
                      disabled={siteToggle.isPending}
                    >
                      Unpublish site
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[13px] text-ob-muted">
                      Publish this vault as a public read-only website.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => siteToggle.mutate(true)}
                      disabled={siteToggle.isPending}
                    >
                      Publish vault site
                    </Button>
                  </div>
                )}
              </section>
            )}

            {tab === "Collab" && (
              <section className="space-y-3">
                <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">
                  Live collaboration
                </h3>
                <label className="flex items-center justify-between gap-2 text-[13px] text-ob-muted">
                  <span>
                    Live collaboration <span className="text-ob-faint">(beta)</span>
                    <span className="block text-[11px] text-ob-faint">
                      Sync open notes across devices and tabs in real time.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    aria-label="Live collaboration"
                    checked={collabDraft ?? Boolean(settings.collabEnabled)}
                    onChange={(e) => {
                      setCollabDraft(e.target.checked);
                      saveCollab.mutate(e.target.checked);
                    }}
                    className="accent-[var(--ob-interactive-accent)]"
                  />
                </label>
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Searchable, grouped shortcut reference (S12.1) — Obsidian's Hotkeys tab. */
function HotkeysTab({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const filtered = filterHotkeys(query);
  const groups = HOTKEY_SECTIONS.map((section) => ({
    section,
    rows: filtered.filter((h) => h.section === section),
  })).filter((g) => g.rows.length > 0);

  return (
    <section className="space-y-4">
      <h3 className="text-[11px] font-medium tracking-wide text-ob-faint uppercase">Hotkeys</h3>
      <Input
        aria-label="Search hotkeys"
        placeholder="Search hotkeys…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {groups.length === 0 && <p className="text-[13px] text-ob-faint">No hotkeys match.</p>}
      {groups.map((g) => (
        <div key={g.section} className="space-y-0.5">
          <div className="px-1 pt-1 text-[11px] font-medium tracking-wide text-ob-faint uppercase">
            {g.section}
          </div>
          {g.rows.map((h) => (
            <div
              key={`${h.section}-${h.keys}-${h.action}`}
              data-hotkey-row
              className="flex items-center justify-between gap-4 rounded px-1 py-1 text-[13px] hover:bg-ob-hover"
            >
              <span className="text-ob-muted">{h.action}</span>
              {h.keys ? (
                <kbd className="shrink-0 rounded border border-ob-border px-1.5 py-0.5 text-[11px] text-ob-faint">
                  {h.keys}
                </kbd>
              ) : (
                <span
                  title="Run from the command palette (⌘P)"
                  className="shrink-0 rounded border border-dashed border-ob-border px-1.5 py-0.5 text-[11px] text-ob-faint/70"
                >
                  ⌘P
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function FontSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: FontChoice;
  onChange: (value: FontChoice) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal text-ob-muted">
        {label}
      </Label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as FontChoice)}
        className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
      >
        {Object.keys(FONT_CHOICES).map((key) => (
          <option key={key} value={key}>
            {key === "default" ? "Default" : key}
          </option>
        ))}
      </select>
    </div>
  );
}

function SettingToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px] text-ob-muted">
      <span>
        {label}
        <span className="block text-[11px] text-ob-faint">{hint}</span>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--ob-interactive-accent)]"
      />
    </label>
  );
}

