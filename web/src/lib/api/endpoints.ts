/** Typed API endpoint functions — the only place the app touches the network. */

import { api, apiJson } from "./client";
import type {
  AttachmentInfo,
  Backlink,
  FolderInfo,
  Graph,
  Note,
  NoteMeta,
  OutgoingLink,
  QuickSwitchResult,
  SearchResult,
  TagCount,
  TokenPair,
  UnlinkedMention,
  User,
  Vault,
  VaultTree,
} from "./types";

// ── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  signup: (body: { email: string; password: string; name: string }) =>
    apiJson<TokenPair>("/auth/signup", "POST", body),
  login: (body: { email: string; password: string }) => apiJson<TokenPair>("/auth/login", "POST", body),
  refresh: () => apiJson<TokenPair>("/auth/refresh", "POST"),
  logout: () => apiJson<{ message: string }>("/auth/logout", "POST"),
  me: () => api<User>("/auth/me"),
  updateMe: (body: { name?: string; avatar_url?: string; settings?: Record<string, unknown> }) =>
    apiJson<User>("/auth/me", "PATCH", body),
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiJson<{ message: string }>("/auth/change-password", "POST", body),
};

// ── Vaults ───────────────────────────────────────────────────────────────────

export const vaultApi = {
  list: () => api<Vault[]>("/vaults"),
  create: (name: string) => apiJson<Vault>("/vaults", "POST", { name }),
  update: (vaultId: string, body: { name?: string; settings?: Record<string, unknown> }) =>
    apiJson<Vault>(`/vaults/${vaultId}`, "PATCH", body),
  remove: (vaultId: string) => apiJson<{ message: string }>(`/vaults/${vaultId}`, "DELETE"),
  tree: (vaultId: string) => api<VaultTree>(`/vaults/${vaultId}/tree`),
};

// ── Folders ──────────────────────────────────────────────────────────────────

export const folderApi = {
  create: (vaultId: string, body: { name: string; parent_id?: string | null }) =>
    apiJson<FolderInfo>(`/vaults/${vaultId}/folders`, "POST", body),
  rename: (vaultId: string, folderId: string, name: string) =>
    apiJson<FolderInfo>(`/vaults/${vaultId}/folders/${folderId}/rename`, "PATCH", { name }),
  move: (vaultId: string, folderId: string, newParentId: string | null) =>
    apiJson<FolderInfo>(`/vaults/${vaultId}/folders/${folderId}/move`, "PATCH", {
      new_parent_id: newParentId,
    }),
  remove: (vaultId: string, folderId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/folders/${folderId}`, "DELETE"),
};

// ── Notes ────────────────────────────────────────────────────────────────────

export const noteApi = {
  create: (vaultId: string, body: { title: string; folder_id?: string | null; content?: string }) =>
    apiJson<Note>(`/vaults/${vaultId}/notes`, "POST", body),
  get: (vaultId: string, noteId: string) => api<Note>(`/vaults/${vaultId}/notes/${noteId}`),
  getByPath: (vaultId: string, path: string) =>
    api<Note>(`/vaults/${vaultId}/notes/by-path?path=${encodeURIComponent(path)}`),
  saveContent: (vaultId: string, noteId: string, content: string, baseUpdatedAt?: string) =>
    apiJson<Note>(`/vaults/${vaultId}/notes/${noteId}/content`, "PUT", {
      content,
      base_updated_at: baseUpdatedAt ?? null,
    }),
  rename: (
    vaultId: string,
    noteId: string,
    body: { title?: string; folder_id?: string | null; move_to_root?: boolean },
  ) => apiJson<NoteMeta>(`/vaults/${vaultId}/notes/${noteId}/rename`, "PATCH", body),
  remove: (vaultId: string, noteId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/notes/${noteId}`, "DELETE"),
};

// ── Links & graph ────────────────────────────────────────────────────────────

export const linkApi = {
  backlinks: (vaultId: string, noteId: string) =>
    api<{ note_id: string; backlinks: Backlink[] }>(`/vaults/${vaultId}/notes/${noteId}/backlinks`),
  outgoing: (vaultId: string, noteId: string) =>
    api<{ note_id: string; outgoing: OutgoingLink[] }>(`/vaults/${vaultId}/notes/${noteId}/outgoing`),
  unlinkedMentions: (vaultId: string, noteId: string) =>
    api<{ note_id: string; unlinked_mentions: UnlinkedMention[] }>(
      `/vaults/${vaultId}/notes/${noteId}/unlinked-mentions`,
    ),
  graph: (vaultId: string) => api<Graph>(`/vaults/${vaultId}/graph`),
  localGraph: (vaultId: string, noteId: string, depth: number) =>
    api<Graph>(`/vaults/${vaultId}/notes/${noteId}/local-graph?depth=${depth}`),
};

// ── Search & tags ────────────────────────────────────────────────────────────

export const searchApi = {
  search: (vaultId: string, q: string, limit = 20, offset = 0) =>
    api<{ query: string; results: SearchResult[]; total: number }>(
      `/vaults/${vaultId}/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
  quickSwitch: (vaultId: string, q: string, limit = 10) =>
    api<QuickSwitchResult[]>(`/vaults/${vaultId}/quick-switch?q=${encodeURIComponent(q)}&limit=${limit}`),
  tags: (vaultId: string) => api<TagCount[]>(`/vaults/${vaultId}/tags`),
  notesByTag: (vaultId: string, tag: string) =>
    api<{ id: string; title: string; path: string }[]>(`/vaults/${vaultId}/tags/${tag}/notes`),
};

// ── Bookmarks ────────────────────────────────────────────────────────────────

export const bookmarkApi = {
  list: (vaultId: string) =>
    api<{ note_id: string; title: string; path: string }[]>(`/vaults/${vaultId}/bookmarks`),
  add: (vaultId: string, noteId: string) =>
    apiJson<{ bookmarked: boolean }>(`/vaults/${vaultId}/bookmarks/${noteId}`, "PUT"),
  remove: (vaultId: string, noteId: string) =>
    apiJson<{ bookmarked: boolean }>(`/vaults/${vaultId}/bookmarks/${noteId}`, "DELETE"),
};

// ── Daily notes & templates ──────────────────────────────────────────────────

export const dailyApi = {
  openDailyNote: (vaultId: string) => apiJson<Note>(`/vaults/${vaultId}/daily-note`, "POST"),
  listTemplates: (vaultId: string) =>
    api<{ id: string; title: string; path: string }[]>(`/vaults/${vaultId}/templates`),
  insertTemplate: (vaultId: string, noteId: string, templateId: string) =>
    apiJson<Note>(`/vaults/${vaultId}/notes/${noteId}/insert-template/${templateId}`, "POST"),
};

// ── Publish ──────────────────────────────────────────────────────────────────

export const publishApi = {
  publish: (vaultId: string, noteId: string) =>
    apiJson<{ token: string; published: boolean }>(`/vaults/${vaultId}/notes/${noteId}/publish`, "POST"),
  status: (vaultId: string, noteId: string) =>
    api<{ published: boolean; token: string | null }>(`/vaults/${vaultId}/notes/${noteId}/publish`),
  unpublish: (vaultId: string, noteId: string) =>
    apiJson<{ published: boolean }>(`/vaults/${vaultId}/notes/${noteId}/publish`, "DELETE"),
  readPublic: (token: string) =>
    api<{ title: string; content: string; updated_at: string; published_at: string }>(
      `/public/${token}`,
    ),
};

// ── Attachments ──────────────────────────────────────────────────────────────

export const attachmentApi = {
  upload: async (vaultId: string, file: File): Promise<AttachmentInfo> => {
    const form = new FormData();
    form.append("file", file);
    return api<AttachmentInfo>(`/vaults/${vaultId}/attachments`, { method: "POST", body: form });
  },
  list: (vaultId: string) => api<AttachmentInfo[]>(`/vaults/${vaultId}/attachments`),
  resolve: (vaultId: string, filename: string) =>
    api<{ url: string; expires_in: number }>(
      `/vaults/${vaultId}/attachments/resolve?filename=${encodeURIComponent(filename)}`,
    ),
  downloadUrl: (vaultId: string, attachmentId: string) =>
    api<{ url: string; expires_in: number }>(`/vaults/${vaultId}/attachments/${attachmentId}/url`),
  remove: (vaultId: string, attachmentId: string) =>
    apiJson<{ message: string }>(`/vaults/${vaultId}/attachments/${attachmentId}`, "DELETE"),
};
